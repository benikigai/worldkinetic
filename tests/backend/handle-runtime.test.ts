// OUTSIDE_WRAPPER acceptance setup. Synthetic source, measurements and CAD bytes test state/HTTP only.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import * as c from '../../src/shared/contracts-v2.js';
import { HANDLE_DATUM_CANONICAL_JSON, HANDLE_DATUM_SHA256, createHandleRequirements } from '../../src/shared/requirements-handle-v2.js';
import { RunStore, requirementIdentity } from '../../src/server/store.js';
import { verifyAcceptanceResponse, verifyAcceptanceHistory } from '../../src/shared/transport-v2.js';
const applicationModule='../../src/server/handle-app.js';
const engine={name:'build123d' as const,version:'synthetic-test-only',imageDigest:'sha256:'+'1'.repeat(64)};
async function toolResult(input:c.ToolInput,passed=true):Promise<c.ToolResult> {
  assert.equal(input.proposal.kind,'python_source'); if(input.proposal.kind!=='python_source')throw Error('Expected source');
  await mkdir(input.outputDir,{recursive:true});
  const source=input.proposal.source,step='SYNTHETIC STEP '+input.attemptId,stl='SYNTHETIC STL '+input.attemptId;
  const sourceHash=await c.sha256(source),geometryHash=await c.sha256(step),r=input.requirements;
  const checks=r.requiredChecks.map((id,i)=>({checkId:id,revisionId:input.outputRevisionId,...requirementIdentity(r),geometryHash,executionMode:'live' as const,
    state:(!passed&&i===0?'failed':'passed') as 'failed'|'passed',label:id,method:c.checkDefinition(id,r.registryId).method,
    expected:c.expectedForCheck(r,id),measured:{synthetic:true},units:c.checkDefinition(id,r.registryId).units,details:'Synthetic state test; no CAD measurement.'}));
  const definitions=[['source','source.py','text/x-python',source],['editable','editable.py','text/x-python',source],['export','candidate.step','model/step',step],['preview','preview.stl','model/stl',stl]] as const;
  const artifacts=[];
  for(const[kind,fileName,mediaType,data]of definitions){const p=path.join(input.outputDir,fileName);await writeFile(p,data);artifacts.push({kind,fileName,mediaType,path:p,bytes:Buffer.byteLength(data),sha256:await c.sha256(data),executionMode:'live' as const});}
  const result={contractVersion:c.CONTRACT_VERSION,...requirementIdentity(r),requirements:r,runId:input.runId,requestId:input.requestId,designId:input.designId,
    inputRevisionId:input.inputRevisionId,outputRevisionId:input.outputRevisionId,attemptId:input.attemptId,units:'mm' as const,executionMode:'live' as const,status:'completed' as const,
    proposal:input.proposal,proposalHash:await c.hashCanonical(input.proposal),sourceSha256:sourceHash,engine,geometryHash,checkBundleHash:null as string|null,checks,artifacts,error:null};
  result.checkBundleHash=await c.computeCheckBundleHash({...result,revisionId:input.outputRevisionId});return result;
}
async function stateSetup() {
  const directory=await mkdtemp(path.join(os.tmpdir(),'wk-bounded-state-'));
  const requirements=await createHandleRequirements({designId:'handle',requirementsVersion:1,setupId:'handle_initial_v1',
    reference:{referenceId:'handle_mount_v1',revisionId:'handle_mount_reference_v1',stepSha256:await c.sha256('SYNTHETIC MOUNT'),datumSpecSha256:HANDLE_DATUM_SHA256}});
  const design:c.Design={designId:'handle',label:'Synthetic state test',units:'mm',stateVersion:0,referenceId:requirements.referenceId,referenceHash:requirements.referenceHash,
    setupId:requirements.setupId,setupHash:requirements.setupHash,baselineRevisionId:'handle_mount_reference_v1',activeRequirementsVersion:1,
    acceptedRevisionId:null,acceptedRequirementsMatch:false,selectedCandidateRevisionId:null,activeRunId:null};
  return {directory,requirements,design,store:new RunStore(directory,design,requirements)};
}
function request(store:RunStore,id:string):c.RunRequest {const d=store.getDesign()!,r=store.getRequirements()!;return {contractVersion:c.CONTRACT_VERSION,requestId:id,designId:d.designId,
  inputRevisionId:d.acceptedRevisionId??d.baselineRevisionId,requirementsVersion:r.requirementsVersion,setupId:r.setupId,units:'mm',instruction:'Synthetic confirmed request'};}
async function start(store:RunStore,id:string){const run=store.getRun(id);await(store.planning as any)(id,run.activeAttemptId);await(store.running as any)(id,run.activeAttemptId);return store.getRun(id);}
async function candidate(s:Awaited<ReturnType<typeof stateSetup>>,run:c.Run,passed:boolean) {
  const draft=s.store.getCandidate(run.candidateRevisionIds.at(-1)!);const r=draft.requirements;
  const data:any={contractVersion:c.CONTRACT_VERSION,runId:run.runId,requestId:run.requestId,designId:run.designId,inputRevisionId:run.inputRevisionId,
    outputRevisionId:draft.revisionId,attemptId:draft.attemptId,units:'mm',requirements:r,proposal:{kind:'python_source',source:'# synthetic '+draft.attemptId,changeSummary:'Synthetic'},outputDir:path.join(s.directory,'stage',draft.attemptId)};
  const result=await toolResult(data,passed);await mkdir(path.join(s.directory,'artifacts'),{recursive:true});const artifacts=[];
  for(const a of result.artifacts){const artifactId='artifact_'+crypto.randomUUID();await writeFile(path.join(s.directory,'artifacts',artifactId),await readFile(a.path));const {path:_,...publicFields}=a;
    artifacts.push({...publicFields,...requirementIdentity(r),artifactId,runId:run.runId,designId:run.designId,revisionId:draft.revisionId,units:'mm' as const,href:'/api/artifacts/'+artifactId});}
  return {...draft,status:passed?'reviewable':'rejected',engine:result.engine,sourceSha256:result.sourceSha256,geometryHash:result.geometryHash,proposalHash:result.proposalHash,
    checkBundleHash:result.checkBundleHash,checks:result.checks,artifacts} as c.Candidate;
}
function accept(store:RunStore,candidate:c.Candidate) {const d=store.getDesign()!;return {contractVersion:c.CONTRACT_VERSION,requestId:'accept_'+crypto.randomUUID(),designId:d.designId,candidateRevisionId:candidate.revisionId,
  requirementsVersion:candidate.requirementsVersion,expectedStateVersion:d.stateVersion,expectedAcceptedRevisionId:d.acceptedRevisionId,registryHash:candidate.registryHash,setupHash:candidate.setupHash,
  geometryHash:candidate.geometryHash!,checkBundleHash:candidate.checkBundleHash!,userActionId:'action_'+crypto.randomUUID()};}

test('rejected completion reserves a distinct second attempt atomically and never accepts it',async()=>{
  const s=await stateSetup(),run=(await s.store.enqueueRun(request(s.store,'repair'))).run;await start(s.store,run.runId);
  const first=await candidate(s,s.store.getRun(run.runId),false);
  await(s.store.completeCandidate as any)(first,undefined,{retryRejected:true});
  const next=s.store.getRun(run.runId);assert.equal(next.status,'queued');assert.equal(next.attemptIds.length,2);assert.equal(s.store.getDesign()!.activeRunId,run.runId);
  assert.notEqual(next.attemptIds[0],next.attemptIds[1]);assert.notEqual(next.candidateRevisionIds[0],next.candidateRevisionIds[1]);
  assert.equal(s.store.getCandidate(first.revisionId).status,'rejected');assert.equal(s.store.getDesign()!.acceptedRevisionId,null);
  await(s.store.fail as any)(run.runId,c.safeError('EXECUTION_FAILED'),first.attemptId);assert.equal(s.store.getRun(run.runId).status,'queued');
  await assert.rejects((s.store.planning as any)(run.runId,first.attemptId));
  await assert.rejects((s.store.completeCandidate as any)(first,undefined,{retryRejected:true}));
  await start(s.store,run.runId);const final=await candidate(s,s.store.getRun(run.runId),true);await(s.store.completeCandidate as any)(final,undefined,{retryRejected:true});
  assert.equal(s.store.getRun(run.runId).status,'completed');assert.equal(s.store.getRun(run.runId).attemptIds.length,2);
  assert.equal(s.store.getDesign()!.acceptedRevisionId,null);assert.equal(s.store.getDesign()!.selectedCandidateRevisionId,final.revisionId);
  assert.deepEqual(final.requirements,first.requirements);await s.store.acceptRevision(accept(s.store,final));
  assert.equal(s.store.getDesign()!.acceptedRevisionId,final.revisionId);
});

test('three measured rejections cap attempts and restart preserves only current active failure',async()=>{
  const s=await stateSetup(),input=request(s.store,'three'),run=(await s.store.enqueueRun(input)).run;
  for(let i=0;i<3;i++){await start(s.store,run.runId);await(s.store.completeCandidate as any)(await candidate(s,s.store.getRun(run.runId),false),undefined,{retryRejected:true});}
  assert.equal(s.store.getRun(run.runId).attemptIds.length,3);assert.equal(s.store.getRun(run.runId).status,'completed');
  assert.equal(s.store.getDesign()!.acceptedRevisionId,null);assert.equal((await s.store.enqueueRun(input)).reused,true);
  const reopened=new RunStore(s.directory,s.design,s.requirements);assert.equal(reopened.getRun(run.runId).attemptIds.length,3);
  const pending=await stateSetup(),p=(await pending.store.enqueueRun(request(pending.store,'restart'))).run;await start(pending.store,p.runId);
  const rejected=await candidate(pending,pending.store.getRun(p.runId),false);await(pending.store.completeCandidate as any)(rejected,undefined,{retryRejected:true});await start(pending.store,p.runId);
  const restored=new RunStore(pending.directory,pending.design,pending.requirements);const rr=restored.getRun(p.runId);
  assert.equal(rr.status,'failed');assert.equal(restored.getCandidate(rejected.revisionId).status,'rejected');assert.equal(restored.getCandidate(rr.candidateRevisionIds[1]!).status,'failed');
});

test('new run supersedes every active old attempt and late retry cannot select or reserve again',async()=>{
  const s=await stateSetup(),run=(await s.store.enqueueRun(request(s.store,'old'))).run;await start(s.store,run.runId);
  await(s.store.completeCandidate as any)(await candidate(s,s.store.getRun(run.runId),false),undefined,{retryRejected:true});await start(s.store,run.runId);
  const late=await candidate(s,s.store.getRun(run.runId),false);const newer=(await s.store.enqueueRun(request(s.store,'new'))).run;
  await(s.store.completeCandidate as any)(late,undefined,{retryRejected:true});assert.equal(s.store.getRun(run.runId).attemptIds.length,2);
  assert.equal(s.store.getRun(run.runId).status,'superseded');assert.equal(s.store.getDesign()!.activeRunId,newer.runId);assert.equal(s.store.getDesign()!.selectedCandidateRevisionId,null);
  const restored=new RunStore(s.directory,s.design,s.requirements);assert.equal(restored.getCandidate(late.revisionId).status,'superseded');
});

async function appOptions() {
  const runtimeDir=await mkdtemp(path.join(os.tmpdir(),'wk-handle-http-')),inputs=await mkdtemp(path.join(os.tmpdir(),'wk-handle-input-'));
  const referenceFiles={stepPath:path.join(inputs,'reference.step'),previewPath:path.join(inputs,'preview.stl'),datumPath:path.join(inputs,'datums.json')};
  await writeFile(referenceFiles.stepPath,'SYNTHETIC MOUNT');await writeFile(referenceFiles.previewPath,'SYNTHETIC MOUNT MESH');await writeFile(referenceFiles.datumPath,HANDLE_DATUM_CANONICAL_JSON);
  return {runtimeDir,referenceFiles};
}
const providerResponse=(source:string)=>new Response(JSON.stringify({id:'resp_synthetic_'+crypto.randomUUID(),object:'response',model:'gpt-6-astra',status:'completed',
  output:[{type:'message',phase:'final_answer',role:'assistant',status:'completed',content:[{type:'output_text',annotations:[],text:JSON.stringify({kind:'python_source',source,changeSummary:'Synthetic model response'})}]}],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}));
async function terminal(store:RunStore,id:string) {for(let i=0;i<400;i++){const r=store.getRun(id);if(['completed','failed','superseded'].includes(r.status))return r;await delay(10);}throw Error('Run did not finish');}

test('handle HTTP requires initial acceptance, freezes exact baseline, repairs and exports only final accepted artifacts',async()=>{
  const {createHandleApplication}=await import(applicationModule),options=await appOptions();let providerCalls=0,toolCalls=0;const dispatched:c.ToolInput[]=[];const contexts:any[]=[];
  const app=await createHandleApplication({...options,apiKey:'synthetic-secret',fetchImpl:async(_url:string,init:RequestInit)=>{providerCalls++;contexts.push(JSON.parse(JSON.parse(String(init.body)).input));return providerResponse('# synthetic attempt '+providerCalls);},
    tool:async(input:c.ToolInput)=>{toolCalls++;dispatched.push(structuredClone({...input,signal:undefined}) as any);return toolResult(input,toolCalls!==1);}});
  await new Promise<void>(r=>app.server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+app.server.address().port;
  const post=async(route:string,body:any,method='POST')=>fetch(url+route,{method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  try {
    const ref:any=await(await fetch(url+'/api/reference')).json();assert.equal(ref.reference.provenance,'trusted_mount_reference');assert.equal(ref.reference.artifacts.length,3);
    for(const a of ref.reference.artifacts){const d=await fetch(url+a.href);assert.equal(d.headers.get('X-WorldKinetics-Revision'),'handle_mount_reference_v1');assert.equal(await c.sha256(new Uint8Array(await d.arrayBuffer())),a.sha256);}
    const confirm=()=>({contractVersion:c.CONTRACT_VERSION,requestId:'confirm_'+crypto.randomUUID(),expectedStateVersion:app.store.getDesign().stateVersion,expectedRequirementsVersion:app.store.getRequirements().requirementsVersion,userActionId:'explicit_confirm',setupId:'handle_refine_v1',confirmedIntent:{}});
    assert.equal((await post('/api/designs/handle/requirements',confirm(),'PATCH')).status,409);assert.equal(providerCalls,0);
    const initialRequest=request(app.store,'initial');const first=await post('/api/runs',initialRequest);assert.equal(first.status,202);const firstBody:any=await first.json();
    const run=await terminal(app.store,firstBody.run.runId);assert.equal(run.status,'completed');assert.equal(run.attemptIds.length,2);assert.equal(providerCalls,2);assert.equal(toolCalls,2);
    assert.notEqual(dispatched[0]!.outputDir,dispatched[1]!.outputDir);assert(dispatched.every(d=>d.outputDir.includes(d.attemptId)));
    assert.equal(contexts[1].feedback.attemptId,dispatched[0]!.attemptId);assert.equal(contexts[1].feedback.checks[0].state,'failed');
    assert.equal(app.store.getDesign().acceptedRevisionId,null);const initial=app.store.getCandidate(run.candidateRevisionIds.at(-1)!);
    assert.equal((await post('/api/runs',initialRequest)).status,200);assert.equal(providerCalls,2);
    const initialAccept=accept(app.store,initial);const a:any=await(await post('/api/revisions/'+initial.revisionId+'/accept',initialAccept)).json();await verifyAcceptanceResponse(a,initialAccept);
    const update=confirm(),changed=await post('/api/designs/handle/requirements',update,'PATCH');assert.equal(changed.status,200);const updated:any=await changed.json();
    assert.equal(updated.requirements.setup.acceptedInitial.acceptanceId,a.acceptance.acceptanceId);assert.equal(updated.requirements.setup.acceptedInitial.sha256,initial.geometryHash);
    assert.equal(updated.requirements.setup.acceptedInitial.sourceSha256,initial.sourceSha256);assert.equal(updated.requirements.referenceHash,initial.referenceHash);
    const second:any=await(await post('/api/runs',request(app.store,'refine'))).json();const refinedRun=await terminal(app.store,second.run.runId);assert.equal(refinedRun.status,'completed');
    const final=app.store.getCandidate(refinedRun.candidateRevisionIds.at(-1)!);assert.equal(final.checks.length,9);assert.equal(app.store.getDesign().acceptedRevisionId,initial.revisionId);
    const d=dispatched.at(-1)!;assert.equal(d.referenceArtifact!.revisionId,'handle_mount_reference_v1');assert.equal(d.inputRevisionId,initial.revisionId);
    assert(d.inputArtifacts.some(x=>x.sha256===initial.geometryHash));assert.equal(contexts.at(-1).acceptedSource.sha256,initial.sourceSha256);
    const finalAccept=accept(app.store,final),accepted:any=await(await post('/api/revisions/'+final.revisionId+'/accept',finalAccept)).json();await verifyAcceptanceResponse(accepted,finalAccept);
    const exportRequest={contractVersion:c.CONTRACT_VERSION,requestId:'download_final',acceptanceId:accepted.acceptance.acceptanceId,manifestId:accepted.manifest.manifestId,manifestHash:accepted.manifest.manifestHash};
    const exported:any=await(await post('/api/revisions/'+final.revisionId+'/export',exportRequest)).json();await verifyAcceptanceResponse(exported);
    for(const artifact of exported.manifest.artifacts){const download=await fetch(url+artifact.href);assert.equal(download.headers.get('X-WorldKinetics-Applicability'),'current');assert.equal(await c.sha256(new Uint8Array(await download.arrayBuffer())),artifact.sha256);}
    await verifyAcceptanceHistory(await(await fetch(url+'/api/acceptances')).json());assert.equal(app.store.listAcceptances().length,2);
  } finally {await new Promise<void>(r=>app.server.close(r));}
  const restored=await createHandleApplication({...options});assert.equal(restored.store.listAcceptances().length,2);assert.equal(restored.store.getDesign().acceptedRequirementsMatch,true);restored.server.emit('close');
});

test('one deadline spans repaired attempts; late tool output cannot become accepted evidence',async()=>{
  const {createHandleApplication}=await import(applicationModule),options=await appOptions();let toolCalls=0,providerCalls=0;
  const app=await createHandleApplication({...options,timeoutMs:120,apiKey:'synthetic-secret',fetchImpl:async()=>{providerCalls++;return providerResponse('# synthetic '+providerCalls);},
    tool:async(input:c.ToolInput)=>{toolCalls++;await delay(70);return toolResult(input,false);}});
  await new Promise<void>(r=>app.server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+app.server.address().port;
  try{const response:any=await(await fetch(url+'/api/runs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request(app.store,'timeout'))})).json();
    const run=await terminal(app.store,response.run.runId);assert.equal(run.status,'failed');assert.equal(run.error?.code,'RUN_TIMEOUT');assert(providerCalls<=2);assert(toolCalls<=2);
    await delay(180);assert.equal(app.store.getDesign().acceptedRevisionId,null);assert.equal(app.store.getRun(run.runId).status,'failed');
  }finally{await new Promise<void>(r=>app.server.close(r));}
});
