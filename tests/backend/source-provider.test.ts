// OUTSIDE_WRAPPER acceptance setup. Injected responses never establish live model generation.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as c from '../../src/shared/contracts-v2.js';
const modulePath='../../src/server/responses-source.js';
const secret='synthetic-provider-key-never-save';
const source='from build123d import *\np = import_step("/input/reference.step")\nexport_step(p,"/out/candidate.step")\n';
const proposal={kind:'python_source',source,changeSummary:'Synthetic source proposal, not executed'};
const response=(p:unknown=proposal,patch={})=>({id:'resp_source_synthetic',object:'response',model:'gpt-6-astra',status:'completed',
  output:[{type:'message',id:'msg_source',phase:'final_answer',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(p),annotations:[]}]}],
  usage:{input_tokens:100,output_tokens:50,total_tokens:150},...patch});
async function input(attemptId='attempt_one') {
  const requirements=await c.createRequirements({designId:'plate',requirementsVersion:1,setupId:'tactile_feature_v1'});
  return {runId:'source_run',requestId:'source_request',attemptId,designId:'plate',inputRevisionId:'baseline_50',
    requirements,instruction:'Add the confirmed tactile feature.',acceptedSource:null,feedback:null};
}
async function allText(dir:string):Promise<string> {
  return (await Promise.all((await readdir(dir,{withFileTypes:true})).map(e=>e.isDirectory()?allText(path.join(dir,e.name)):readFile(path.join(dir,e.name),'utf8')))).join('\n');
}

test('source planner sends frozen requirements with bounded strict Responses output and records exact attempt identity',async()=>{
  const {ResponsesSourcePlanner}=await import(modulePath);const runtimeDir=await mkdtemp(path.join(os.tmpdir(),'wk-source-provider-'));
  let calls=0;const request=await input();
  const planner=new ResponsesSourcePlanner({runtimeDir,apiKey:secret,fetchImpl:async(url:string,options:RequestInit)=>{
    calls++;assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(options.redirect,'error');
    assert.equal(new Headers(options.headers).get('authorization'),'Bearer '+secret);
    const body=JSON.parse(String(options.body));assert.equal(body.model,'gpt-6-astra');assert.equal(body.store,false);assert.equal(body.background,false);
    assert.equal(body.text.format.type,'json_schema');assert.equal(body.text.format.strict,true);assert(!body.tools?.length);
    assert(body.max_output_tokens>0&&body.max_output_tokens<=8192);assert(options.signal instanceof AbortSignal);
    assert(String(body.instructions).includes('/input/reference.step'));assert(String(body.instructions).includes('/input/baseline.step'));
    assert(String(body.instructions).includes('/out/candidate.step'));assert(JSON.stringify(body).includes(request.requirements.setupHash));
    return new Response(JSON.stringify(response()));
  }});
  assert.deepEqual(await planner.generate(request,new AbortController().signal),proposal);
  const receipt=JSON.parse(await readFile(path.join(runtimeDir,'runs',request.runId,'attempts',request.attemptId,'provider','receipt.json'),'utf8'));
  assert.equal(receipt.responseId,'resp_source_synthetic');assert.equal(receipt.requestedModel,'gpt-6-astra');assert.equal(receipt.reportedModel,'gpt-6-astra');
  assert.equal(receipt.attemptId,request.attemptId);assert.equal(receipt.runId,request.runId);assert.equal(receipt.sourceSha256,await c.sha256(source));
  assert.equal(receipt.proposalHash,await c.hashCanonical(proposal));assert.deepEqual(receipt.usage,{input_tokens:100,output_tokens:50,total_tokens:150});
  try {await planner.generate(request,new AbortController().signal);}catch{}assert.equal(calls,1,'same attempt must not issue a second provider request');
  try {await planner.generate({...request,instruction:'different'},new AbortController().signal);}catch{}assert.equal(calls,1);
  assert.equal((await allText(runtimeDir)).includes(secret),false);
});

test('accepted source and checked feedback are hash-bound and dispatched literally without host execution',async()=>{
  const {ResponsesSourcePlanner}=await import(modulePath);const runtimeDir=await mkdtemp(path.join(os.tmpdir(),'wk-source-context-'));
  const request:any=await input();request.inputRevisionId='accepted_revision';
  request.acceptedSource={revisionId:'accepted_revision',source:'print("never execute")\n',sha256:await c.sha256('print("never execute")\n')};
  request.feedback={attemptId:'prior_attempt',source:'raise RuntimeError("previous")\n',sourceSha256:await c.sha256('raise RuntimeError("previous")\n'),checks:[],error:c.safeError('EXPORT_FAILED')};
  let calls=0;const planner=new ResponsesSourcePlanner({runtimeDir,apiKey:secret,fetchImpl:async(_url:string,options:RequestInit)=>{
    calls++;const body=JSON.parse(String(options.body));assert(JSON.stringify(body).includes(request.acceptedSource.sha256));
    assert(JSON.stringify(body).includes(request.feedback.sourceSha256));assert(JSON.stringify(body).includes('never execute'));
    return new Response(JSON.stringify(response()));
  }});
  await planner.generate(request,new AbortController().signal);assert.equal(calls,1);
  for(const alter of [
    (r:any)=>{r.acceptedSource.sha256='0'.repeat(64);},(r:any)=>{r.acceptedSource.revisionId='wrong';},
    (r:any)=>{r.feedback.sourceSha256='0'.repeat(64);},(r:any)=>{r.requirements.setupHash='0'.repeat(64);},
    (r:any)=>{r.designId='another';},(r:any)=>{r.attemptId='../escape';},
  ]) {const r=structuredClone(request);r.attemptId=crypto.randomUUID();alter(r);await assert.rejects(planner.generate(r,new AbortController().signal));}
  assert.equal(calls,1);
});

test('unsafe provider shapes, authority injection and oversized source never produce a proposal',async()=>{
  const {ResponsesSourcePlanner}=await import(modulePath);const runtimeDir=await mkdtemp(path.join(os.tmpdir(),'wk-source-rejections-'));
  const bad=[response(proposal,{status:'incomplete'}),response(proposal,{model:'another'}),
    response(proposal,{output:[{type:'function_call',name:'shell',arguments:'{}'}]}),
    response({...proposal,requirements:{minimum:0}}),response({...proposal,source:'😀'.repeat(20000)}),
    response({kind:'numeric_operation',operation:{name:'resize_plate',parameters:{lengthMm:36}}}),
    response(proposal,{output:[{type:'message',phase:'commentary',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(proposal),annotations:[]}]}]}),
  ];
  for(const [i,body]of bad.entries()) {const planner=new ResponsesSourcePlanner({runtimeDir,apiKey:secret,fetchImpl:async()=>new Response(JSON.stringify(body))});
    await assert.rejects(planner.generate(await input('bad_'+i),new AbortController().signal));}
  const oversized=new ResponsesSourcePlanner({runtimeDir,apiKey:secret,fetchImpl:async()=>new Response('x'.repeat(1024*1024+1))});
  await assert.rejects(oversized.generate(await input('oversize'),new AbortController().signal));
  assert.equal((await allText(runtimeDir)).includes(secret),false);
});

test('concurrent duplicate attempts and aborted/failed transport cannot retry invisibly',async()=>{
  const {ResponsesSourcePlanner}=await import(modulePath);const runtimeDir=await mkdtemp(path.join(os.tmpdir(),'wk-source-duplicates-'));
  let calls=0;let release!:()=>void;const gate=new Promise<void>(r=>release=r);
  const planner=new ResponsesSourcePlanner({runtimeDir,apiKey:secret,fetchImpl:async()=>{calls++;await gate;return new Response(JSON.stringify(response()));}});
  const request=await input();const one=planner.generate(request,new AbortController().signal);const two=planner.generate(request,new AbortController().signal);
  const completed=Promise.allSettled([one,two]);setTimeout(release,20);const outcomes=await completed;
  assert.equal(calls,1);assert(outcomes.some(r=>r.status==='fulfilled'));
  const aborted=new AbortController();aborted.abort();await assert.rejects(planner.generate(await input('preabort'),aborted.signal));assert.equal(calls,1);
  const failure=new ResponsesSourcePlanner({runtimeDir,apiKey:secret,fetchImpl:async()=>{calls++;throw new Error(secret);}});
  const bad=await input('transport_failure');await assert.rejects(failure.generate(bad,new AbortController().signal),e=>!String(e).includes(secret));
  try {await failure.generate(bad,new AbortController().signal);}catch{}assert.equal(calls,2);
  assert.equal((await allText(runtimeDir)).includes(secret),false);
});
