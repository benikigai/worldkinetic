// OUTSIDE_WRAPPER: local public-presentation seam, not new transport shapes or browser evidence.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

// consumerAction(snapshot, {sizesReviewed, canAccept, changing}) is used by mountLive to select at most one primary action.
// It returns 'review'|'confirm'|'run'|'accept'|'download'|null and must retain server/renderer eligibility.
const path = '../../src/client/workspace/consumer-state.js';
const handle = JSON.parse(await readFile(new URL('../../fixtures/api/v2/handle-flow.fixture.json', import.meta.url),'utf8'));
const plate = JSON.parse(await readFile(new URL('../../fixtures/api/v2/reviewable.fixture.json', import.meta.url),'utf8'));
function snapshot() {
  const bootstrap = structuredClone(handle.initialAccepted.bootstrap);
  bootstrap.executionMode = 'live'; bootstrap.candidates = []; bootstrap.runs = [];
  bootstrap.design.acceptedRevisionId = null; bootstrap.design.selectedCandidateRevisionId = null;
  return { bootstrap, history: {acceptances:[],manifests:[]}, reference: null, draft:{lengthMm:'',instruction:'Create a handle from the sample sizes'},
    trusted:true,loading:false,busy:false,error:null,pendingAction:null,canConfirm:true,canRefine:false,canRun:false,canAccept:false,canDownload:false };
}
const local = { sizesReviewed:false,canAccept:false,changing:false };

test('public handle progression keeps local size review, confirmation, creation and acceptance distinct', async () => {
  const { consumerAction } = await import(path), s = snapshot();
  assert.equal(consumerAction(s,local),'review');
  assert.equal(consumerAction(s,{...local,sizesReviewed:true}),'confirm');
  assert.equal(consumerAction({...s,canRun:true},{...local,sizesReviewed:true}),'run');
  assert.equal(consumerAction({...s,canConfirm:false,canAccept:true},local),null, 'Unrendered candidate cannot offer acceptance');
  assert.equal(consumerAction({...s,canConfirm:false,canAccept:true},{...local,canAccept:true}),'accept');
  assert.equal(consumerAction({...s,canConfirm:false,canAccept:false,canDownload:true},local),'download');
  assert.equal(consumerAction({...s,canConfirm:false,canRefine:true,canDownload:true},{...local,changing:true}),'review');
});

test('missing input, stale/uncertain data and unavailable execution never offer generation or acceptance', async () => {
  const { consumerAction } = await import(path), s=snapshot();
  for (const patch of [{trusted:false},{loading:true},{busy:true},{pendingAction:'requirements'},{error:'Sign in required'},
    {draft:{lengthMm:'',instruction:''},canConfirm:false}]) {
    assert.equal(consumerAction({...s,...patch},{...local,sizesReviewed:true,canAccept:true}),null);
  }
  const unavailable={...s,bootstrap:{...s.bootstrap,executionMode:'unavailable'},canRun:false};
  assert.notEqual(consumerAction(unavailable,{...local,sizesReviewed:true}),'run');
  assert.equal(consumerAction({...unavailable,canDownload:true,canConfirm:false},local),'download', 'Execution availability must not disable a current verified file');
});

test('a plate or fixture connection cannot silently become the main handle interaction', async () => {
  const { consumerAction } = await import(path), s=snapshot();
  for(const bootstrap of [plate,{...s.bootstrap,executionMode:'fixture'}]) {
    assert.equal(consumerAction({...s,bootstrap,canRun:true,canAccept:true,canDownload:true},{...local,sizesReviewed:true,canAccept:true}),null);
  }
});


test('step indication follows verified handle state without elapsed-time or fixture progress', async () => {
  const { consumerStep } = await import(path), s=snapshot();
  assert.equal(consumerStep(s,local),0);
  assert.equal(consumerStep(s,{...local,sizesReviewed:true}),1);
  assert.equal(consumerStep({...s,canAccept:true},local),2);
  assert.equal(consumerStep({...s,bootstrap:{...s.bootstrap,design:{...s.bootstrap.design,activeRunId:'fake_run'}}},local),2);
  assert.equal(consumerStep({...s,canDownload:true},local),3);
  assert.equal(consumerStep({...s,canDownload:true,canRefine:true},{...local,changing:true}),0);
  for(const patch of [{trusted:false},{loading:true},{error:'Failed to verify'}, {bootstrap:plate}]) assert.equal(consumerStep({...s,...patch},local),null);
});
