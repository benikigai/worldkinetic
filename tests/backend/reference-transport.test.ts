// OUTSIDE_WRAPPER acceptance setup; reference descriptors and file bytes here are synthetic.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import * as c from '../../src/shared/contracts-v2.js';
import { ReferenceResponseSchema } from '../../src/shared/reference-v2.js';
import { HANDLE_DATUM_SHA256 } from '../../src/shared/requirements-handle-v2.js';

test('no synthetic design or artifact name bypasses a plate reference hash or original revision',async()=>{
  const fixture=JSON.parse(await readFile(new URL('../../fixtures/api/v2/tool-input.fixture.json',import.meta.url),'utf8'));
  const r=await c.createRequirements({designId:'synthetic_test_design',requirementsVersion:1,setupId:'resize_centered_v1',lengthMm:36});
  const data={...fixture,designId:r.designId,inputRevisionId:'synthetic_initial',requirements:r,
    registryCanonicalJson:r.registryCanonicalJson,setupCanonicalJson:r.setupCanonicalJson,
    inputArtifacts:[{artifactId:'baseline_test',revisionId:'synthetic_initial',kind:'reference',units:'mm',path:'/synthetic/reference.step',sha256:'0'.repeat(64)}]};
  await assert.rejects(c.verifyToolInput(data));
  data.inputRevisionId='baseline_50';data.inputArtifacts[0]!.revisionId='baseline_50';
  await assert.rejects(c.verifyToolInput(data));
  data.inputArtifacts[0]!.sha256=r.referenceHash;await c.verifyToolInput(data);
  data.inputRevisionId='accepted_revision';data.inputArtifacts[0]!.revisionId='accepted_revision';
  await assert.rejects(c.verifyToolInput(data));
});

test('public handle reference keeps trusted two-pad provenance, datum and each actual-shaped download distinct',()=>{
  const artifacts=['model/step','model/stl','application/json'].map((mediaType,i)=>({artifactId:'reference_handle_'+i,fileName:['mount.step','mount.stl','datums.json'][i],mediaType,bytes:100,
    sha256:i===2?HANDLE_DATUM_SHA256:String(i+1).repeat(64),href:'/api/reference/artifacts/reference_handle_'+i}));
  const good={contractVersion:c.CONTRACT_VERSION,reference:{referenceId:'handle_mount_v1',revisionId:'handle_mount_reference_v1',units:'mm',provenance:'trusted_mount_reference',datumSpecSha256:HANDLE_DATUM_SHA256,artifacts}};
  ReferenceResponseSchema.parse(good);
  for(const change of [
    (r:any)=>{r.revisionId='accepted_initial';},(r:any)=>{r.datumSpecSha256='0'.repeat(64);},
    (r:any)=>{r.artifacts[2].sha256='0'.repeat(64);},(r:any)=>{r.artifacts.pop();},
    (r:any)=>{r.artifacts[1]=r.artifacts[0];},(r:any)=>{r.provenance='live';},
    (r:any)=>{r.acceptanceId='invented';},(r:any)=>{r.artifacts[0].path='/private';},
  ]){const value=structuredClone(good);change(value.reference);assert.equal(ReferenceResponseSchema.safeParse(value).success,false);}
  const plate={contractVersion:c.CONTRACT_VERSION,reference:{referenceId:'plate_revised_50x35x5',revisionId:'baseline_50',units:'mm',provenance:'saved_reference',artifacts:artifacts.slice(0,2)}};
  ReferenceResponseSchema.parse(plate);
});
