// OUTSIDE_WRAPPER acceptance setup. This checks synthetic transport artifacts, never runtime execution.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import * as c from '../../src/shared/contracts-v2.js';
import { verifyAcceptanceHistory } from '../../src/shared/transport-v2.js';

test('handle flow fixture binds initial acceptance, independent reference and final acceptance without live claims',async()=>{
  const fixture=JSON.parse(await readFile(new URL('../../fixtures/api/v2/handle-flow.fixture.json',import.meta.url),'utf8'));
  assert.match(fixture.label,/synthetic/i);assert.equal(fixture.executionEvidence,'NOT_RUN');
  const names=['initialAccepted','refinementReviewable','finalAccepted'];
  for(const name of names){const state=fixture[name];const b=c.BootstrapSchema.parse(state.bootstrap);await verifyAcceptanceHistory(state.history);
    assert.equal(b.executionMode,'fixture');assert.equal(b.design!.designId,'handle_fixture');
    for(const candidate of b.candidates){await c.verifyCandidateEvidence(candidate);assert.equal(candidate.executionMode,'fixture');assert.equal(candidate.engine?.name,'fixture');}
    for(const a of state.history.acceptances){assert.equal(a.candidate.executionMode,'fixture');assert.match(a.request.userActionId,/fixture|synthetic/);}
  }
  const initial=fixture.initialAccepted,review=fixture.refinementReviewable,final=fixture.finalAccepted;
  assert.equal(initial.history.acceptances.length,1);assert.equal(review.history.acceptances.length,1);assert.equal(final.history.acceptances.length,2);
  const accepted=initial.history.acceptances[0],candidate=accepted.candidate;
  assert.equal(candidate.setupId,'handle_initial_v1');assert.equal(candidate.checks.length,8);
  assert.equal(initial.bootstrap.design.acceptedRevisionId,candidate.revisionId);assert.equal(initial.bootstrap.design.acceptedRequirementsMatch,true);
  const r=review.bootstrap.requirements;assert.equal(r.setupId,'handle_refine_v1');assert.equal(r.requiredChecks.length,9);
  const baseline=r.setup.acceptedInitial;
  for(const[key,value]of Object.entries({acceptanceId:accepted.acceptanceId,revisionId:candidate.revisionId,sha256:candidate.geometryHash,
    requirementsId:candidate.requirementsId,requirementsVersion:candidate.requirementsVersion,setupHash:candidate.setupHash,sourceSha256:candidate.sourceSha256,checkBundleHash:candidate.checkBundleHash})) assert.equal(baseline[key],value,key);
  assert(candidate.artifacts.some((a:any)=>a.artifactId===baseline.artifactId&&a.sha256===baseline.sha256&&a.mediaType==='model/step'));
  assert.equal(r.referenceHash,candidate.referenceHash);assert.notEqual(r.referenceHash,baseline.sha256);
  assert.equal(r.setup.reference.revisionId,'handle_mount_reference_v1');assert.notEqual(r.setup.reference.revisionId,baseline.revisionId);
  assert.equal(review.bootstrap.design.acceptedRevisionId,candidate.revisionId);assert.equal(review.bootstrap.design.acceptedRequirementsMatch,false);
  const revised=review.bootstrap.candidates.find((a:any)=>a.revisionId===review.bootstrap.design.selectedCandidateRevisionId);
  assert.equal(revised.status,'reviewable');assert.equal(revised.inputRevisionId,candidate.revisionId);assert.equal(revised.checks.length,9);
  const latest=final.history.acceptances.reduce((a:any,b:any)=>a.stateVersion>b.stateVersion?a:b);
  assert.equal(latest.candidate.revisionId,revised.revisionId);assert.equal(latest.request.expectedAcceptedRevisionId,candidate.revisionId);
  assert.equal(final.bootstrap.design.acceptedRevisionId,revised.revisionId);assert.equal(final.bootstrap.design.acceptedRequirementsMatch,true);
  assert.deepEqual(final.history.acceptances.find((a:any)=>a.acceptanceId===accepted.acceptanceId),accepted);
});
