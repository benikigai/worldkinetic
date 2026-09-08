import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import * as c from '../../src/shared/contracts-v2.js';
const transportPath = '../../src/shared/transport-v2.js';
const original = JSON.parse(await readFile(new URL('../../fixtures/api/v2/reviewable.fixture.json', import.meta.url), 'utf8'));
async function pair(version = 8, previous: string | null = null) {
  const candidate = structuredClone(original.candidates[0]);
  const request = { contractVersion: c.CONTRACT_VERSION, requestId: `fixture_accept_${version}`, designId: candidate.designId,
    candidateRevisionId: candidate.revisionId, requirementsVersion: candidate.requirementsVersion, expectedStateVersion: version - 1,
    expectedAcceptedRevisionId: previous, registryHash: candidate.registryHash, setupHash: candidate.setupHash,
    geometryHash: candidate.geometryHash, checkBundleHash: candidate.checkBundleHash, userActionId: `fixture_action_${version}` };
  const acceptance = { contractVersion: c.CONTRACT_VERSION, acceptanceId: `fixture_acceptance_${version}`, request,
    acceptedAt: '2026-09-08T20:00:00.000Z', stateVersion: version, candidate, requirements: candidate.requirements };
  const payload = { contractVersion: c.CONTRACT_VERSION, manifestId: `fixture_manifest_${version}`, acceptanceId: acceptance.acceptanceId,
    designId: candidate.designId, runId: candidate.runId, revisionId: candidate.revisionId, requirements: candidate.requirements,
    checkBundleHash: candidate.checkBundleHash, geometryHash: candidate.geometryHash, sourceSha256: candidate.sourceSha256,
    proposalHash: candidate.proposalHash, engine: candidate.engine, checks: candidate.checks, changeSummary: candidate.changeSummary,
    units: candidate.units, artifacts: candidate.artifacts };
  const manifest = { ...payload, manifestHash: await c.hashCanonical(payload) };
  return { contractVersion: c.CONTRACT_VERSION, reused: false, acceptance, manifest };
}
async function rehash(manifest: any) {
  const { manifestHash: _, ...payload } = manifest;
  manifest.manifestHash = await c.hashCanonical(payload);
}

test('shared transport exports strict envelopes and verifies a synthetic acceptance pair', async () => {
  const t = await import(transportPath);
  const response = await pair();
  assert.deepEqual(await t.verifyAcceptanceResponse(response, response.acceptance.request), response);
  assert.equal(response.acceptance.candidate.executionMode, 'fixture');
  assert.equal(t.AcceptanceMutationResponseSchema.safeParse({ ...response, privatePath: '/secret' }).success, false);
  const event = JSON.parse(await readFile(new URL('../../fixtures/api/v2/event.fixture.json', import.meta.url), 'utf8'));
  t.EventsResponseSchema.parse({ contractVersion: c.CONTRACT_VERSION, events: [event] });
  t.ApiErrorResponseSchema.parse({ contractVersion: c.CONTRACT_VERSION, error: c.safeError('STATE_CONFLICT') });
  t.RunMutationResponseSchema.parse({ contractVersion: c.CONTRACT_VERSION, reused: true, run: original.runs[0] });
  t.RequirementsMutationResponseSchema.parse({ contractVersion: c.CONTRACT_VERSION, reused: false, design: original.design, requirements: original.requirements });
  assert.equal(t.ApiErrorResponseSchema.safeParse({ contractVersion: 'old', error: c.safeError('STATE_CONFLICT') }).success, false);
});

test('valid individual records cannot hide acceptance-manifest join and hash mismatches', async () => {
  const t = await import(transportPath);
  const mutations = [
    (x: any) => { x.manifest.manifestHash = '0'.repeat(64); },
    (x: any) => { x.manifest.acceptanceId = 'another_acceptance'; },
    (x: any) => { x.manifest.revisionId = 'another_revision'; },
    (x: any) => { x.manifest.geometryHash = '0'.repeat(64); },
    (x: any) => { x.manifest.sourceSha256 = '0'.repeat(64); },
    (x: any) => { x.manifest.proposalHash = '0'.repeat(64); },
    (x: any) => { x.manifest.engine.version = 'another_engine'; },
    (x: any) => { x.manifest.changeSummary = 'Different change'; },
    (x: any) => { x.manifest.artifacts[0].bytes++; },
    (x: any) => { x.manifest.checks[0].details = 'Changed evidence'; },
    (x: any) => { x.acceptance.request.candidateRevisionId = 'another_revision'; },
    (x: any) => { x.acceptance.request.geometryHash = '0'.repeat(64); },
    (x: any) => { x.acceptance.request.checkBundleHash = '0'.repeat(64); },
    (x: any) => { x.acceptance.request.requirementsVersion++; },
    (x: any) => { x.acceptance.stateVersion++; },
    (x: any) => { x.acceptance.requirements = structuredClone(original.requirements); x.acceptance.requirements.requirementsId = 'different_requirement'; },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const value = await pair(); mutate(value);
    if (index !== 0) await rehash(value.manifest);
    await assert.rejects(t.verifyAcceptanceResponse(value), `mutation ${index}`);
  }
  const valid = await pair();
  await assert.rejects(t.verifyAcceptanceResponse(valid, { ...valid.acceptance.request, requestId: 'different_request' }));
});

test('history verifies unique complete pairs and preserves later acceptance of the same revision', async () => {
  const t = await import(transportPath);
  const first = await pair(), latest = await pair(9, first.acceptance.candidate.revisionId);
  const history = { contractVersion: c.CONTRACT_VERSION, acceptances: [latest.acceptance, first.acceptance], manifests: [latest.manifest, first.manifest] };
  assert.deepEqual(await t.verifyAcceptanceHistory(history), history);
  for (const value of [
    { ...history, manifests: [first.manifest] },
    { ...history, acceptances: [first.acceptance, first.acceptance] },
    { ...history, manifests: [first.manifest, first.manifest] },
  ]) await assert.rejects(t.verifyAcceptanceHistory(value));
  const published = JSON.parse(await readFile(new URL('../../fixtures/api/v2/acceptance-response.fixture.json', import.meta.url), 'utf8'));
  await t.verifyAcceptanceResponse(published);
  assert.equal(published.acceptance.candidate.executionMode, 'fixture');
  assert(published.acceptance.candidate.artifacts.every((a: any) => a.executionMode === 'fixture'));
});
