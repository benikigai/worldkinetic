import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { ExportRequest } from '../shared/contracts-v2.js';
import type { Manifest } from '../shared/state-v2.js';
import { PackageRequestSchema, PACKAGE_MAX_BYTES, type PackageRequest, type PackageRfq } from '../shared/package-v2.js';
import { ReferenceSchema } from '../shared/reference-v2.js';
import { verifyAcceptanceResponse } from '../shared/transport-v2.js';
import { ArtifactStore } from './artifacts.js';
import { RunStore, StoreError } from './store.js';
import type { PublicReference } from './reference.js';

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const evidenceError = () => new StoreError(409, 'EVIDENCE_CONFLICT', 'Package evidence is unavailable or changed.');
const exportError = () => new StoreError(503, 'EXPORT_FAILED', 'Prototype package could not be prepared.');
type Entry = { path: string; bytes: Buffer };

// Python is already required by the engineering runtime. Only this fixed stdlib program runs.
const zipProgram = `import base64, io, json, sys, zipfile
entries = json.load(sys.stdin)
out = io.BytesIO()
with zipfile.ZipFile(out, 'w', compression=zipfile.ZIP_STORED) as archive:
    for entry in entries:
        info = zipfile.ZipInfo(entry['path'], date_time=(1980, 1, 1, 0, 0, 0))
        info.create_system = 3
        info.external_attr = 0o100644 << 16
        archive.writestr(info, base64.b64decode(entry['data'], validate=True))
sys.stdout.buffer.write(out.getvalue())
`;

async function zip(entries: Entry[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', ['-I', '-c', zipProgram], {
      stdio: ['pipe', 'pipe', 'ignore'], env: { PATH: process.env.PATH, LANG: 'C.UTF-8' },
    });
    const chunks: Buffer[] = [];
    let length = 0, failed = false;
    const fail = () => { failed = true; child.kill('SIGKILL'); reject(exportError()); };
    const timer = setTimeout(fail, 10_000);
    child.on('error', fail);
    child.stdin.on('error', fail);
    child.stdout.on('data', (chunk: Buffer) => {
      length += chunk.length;
      if (length > PACKAGE_MAX_BYTES) fail();
      else if (!failed) chunks.push(chunk);
    });
    child.once('close', code => {
      clearTimeout(timer);
      if (code !== 0 || failed || length === 0) reject(exportError());
      else resolve(Buffer.concat(chunks));
    });
    child.stdin.end(JSON.stringify(entries.map(e => ({ path: e.path, data: e.bytes.toString('base64') }))));
  });
}

function preferences(rfq: PackageRfq = {}) {
  return { quantity: rfq.quantity ?? null, material: rfq.material ?? null, finish: rfq.finish ?? null,
    destination: rfq.destination ?? null, neededBy: rfq.neededBy ?? null };
}

function prototypeBrief(manifest: Manifest) {
  const r = manifest.requirements;
  const lines = [
    'WorldKinetics prototype handoff', '', 'Status: shape-and-fit prototype. Physical fit and strength have not been tested.',
    `Revision: ${manifest.revisionId}`, `Run: ${manifest.runId}`, `Acceptance: ${manifest.acceptanceId}`,
    `Manifest: ${manifest.manifestId}`, `Manifest SHA256: ${manifest.manifestHash}`,
    `Contract: ${manifest.contractVersion}`, `Requirements: ${r.requirementsId} (version ${r.requirementsVersion})`,
    `Units: ${manifest.units}; mesh coordinates must be interpreted in millimeters.`,
    `Checks: ${manifest.checks.filter(c => c.state === 'passed').length}/${r.requiredChecks.length} passed.`,
    `Check bundle SHA256: ${manifest.checkBundleHash}`, '',
  ];
  if (r.registryId === 'handle_sample_v1') {
    const fields = [['Mount pitch', 'handle.mount_interface', 'mountPitchMm', r.setup.geometry.sampleRequirements.mountPitchMm, 'required'],
      ['Minimum finger gap', 'handle.grip_clearance', 'minimumGapMm', r.setup.geometry.sampleRequirements.minimumFingerGapMm, 'minimum'],
      ['Overall length', 'handle.envelope', 'overallLengthMm', r.setup.geometry.sampleRequirements.maximumOverallLengthMm, 'maximum']] as const;
    lines.push('Critical dimensions from accepted check evidence:');
    for (const [label, id, field, required, limit] of fields) {
      const measured = manifest.checks.find(c => c.checkId === id)?.measured;
      const m = measured && typeof measured === 'object' && !Array.isArray(measured) ? measured.measurement : null;
      const value = m && typeof m === 'object' && !Array.isArray(m) ? m[field] : undefined;
      lines.push(`${label}: measured ${typeof value === 'number' && Number.isFinite(value) ? value + ' mm' : 'not available in summary'}; ${limit} ${required} mm.`);
    }
    lines.push('', 'Items to review: printed handle body; mounting hardware and threads TBD.',
      'No screws, inserts, fastener quantities or installation method have been selected.');
  } else lines.push('Item to review: prototype plate. Installation hardware is unspecified.');
  lines.push('', 'Before making or using:',
    'Confirm real dimensions, mounting method, material, load and physical fit with the maker.',
    'For self-printing, use the STL with a slicer profile for your exact printer and material.',
    'For a supplier, use the STEP or STL and request a prototype review and quote.',
    'No technical drawing, manufacturing-ready BOM, native FreeCAD file or printer-specific G-code is supplied.',
    'Costs, production time and transit time: Quote required.', '',
    'Editable source (advanced):',
    'source.py and editable.py are the unchanged accepted Python bytes. They have not been rewritten for local paths.',
    `Recorded engine: ${manifest.engine?.name} ${manifest.engine?.version}; image ${manifest.engine?.imageDigest}.`,
    'The original isolated runner exposes the supplied input/ directory as read-only /input and an empty writable directory as /out.',
    'For handle refinement, input/baseline.step is the exact accepted initial STEP. input/reference.step contains the mount reference.',
    'The source can use absolute /input/baseline.step or /input/reference.step and writes /out/candidate.step.',
    'Recreating that isolated build123d environment is required to run the original source. Do not run it as a printer instruction.',
    'Use the already exported STEP/STL directly unless you need to edit the Python; edits require fresh checks and approval.', '',
    'File identity: see package.json for SHA256 and byte length of every other archive entry.',
    'Full requirements, expected values, measurements, check states and methods are in evidence/.',
    'This package preserves past accepted evidence; it does not perform new geometry or physical checks.', '');
  return lines.join('\n');
}

export async function buildPrototypePackage(store: RunStore, artifacts: ArtifactStore, reference: PublicReference | undefined,
  revisionId: string, input: PackageRequest) {
  try { return await buildCurrentPackage(store, artifacts, reference, revisionId, input); }
  catch (error) { if (error instanceof StoreError) throw error; throw evidenceError(); }
}

async function buildCurrentPackage(store: RunStore, artifacts: ArtifactStore, reference: PublicReference | undefined,
  revisionId: string, input: PackageRequest) {
  const request = PackageRequestSchema.parse(input);
  const { rfq, ...identity }: { rfq?: PackageRfq } & ExportRequest = request;
  const pair = await store.readCurrentExport(revisionId, identity);
  await verifyAcceptanceResponse({ contractVersion: request.contractVersion, reused: false, ...pair });
  if (!reference) throw exportError();
  const { manifest, acceptance } = pair, r = manifest.requirements;
  const entries: Entry[] = [];
  let total = 0;
  const add = (name: string, bytes: Buffer | string) => {
    const content = typeof bytes === 'string' ? Buffer.from(bytes) : bytes;
    total += content.length;
    if (total > PACKAGE_MAX_BYTES || entries.some(e => e.path === name)) throw exportError();
    entries.push({ path: name, bytes: content });
  };
  const addJson = (name: string, value: unknown) => add(name, JSON.stringify(value, null, 2) + '\n');
  const names = { source: 'source.py', editable: 'editable.py', export: 'candidate.step', preview: 'preview.stl' } as const;
  for (const artifact of manifest.artifacts) {
    if (total + artifact.bytes > PACKAGE_MAX_BYTES) throw exportError();
    const name = artifact.kind in names ? names[artifact.kind as keyof typeof names] : `artifacts/${artifact.artifactId}-${artifact.fileName}`;
    add(name, await artifacts.read(artifact));
  }
  const ref = ReferenceSchema.parse(await reference.describe());
  const step = ref.artifacts.find(a => a.mediaType === 'model/step');
  if (ref.referenceId !== r.referenceId || ref.units !== r.units || !step || step.sha256 !== r.referenceHash) throw evidenceError();
  const readReference = async (id: string, hash: string) => {
    const data = await reference.read(id);
    if (data.artifact.artifactId !== id || data.artifact.sha256 !== hash || data.bytes.length !== data.artifact.bytes || digest(data.bytes) !== hash) throw evidenceError();
    return data.bytes;
  };
  add('input/reference.step', await readReference(step.artifactId, r.referenceHash));
  addJson('evidence/reference.json', ref);
  if (r.registryId === 'handle_sample_v1') {
    if (ref.revisionId !== r.setup.reference.revisionId) throw evidenceError();
    const datum = ref.artifacts.find(a => a.mediaType === 'application/json');
    if (!datum || datum.sha256 !== r.setup.reference.datumSpecSha256) throw evidenceError();
    add('input/datums.json', await readReference(datum.artifactId, datum.sha256));
    const initial = r.setup.acceptedInitial;
    if (initial) {
      const prior = store.getAcceptance(initial.acceptanceId);
      const priorManifest = store.listManifests().find(m => m.acceptanceId === initial.acceptanceId);
      if (!prior || !priorManifest) throw evidenceError();
      await verifyAcceptanceResponse({ contractVersion: request.contractVersion, reused: false, acceptance: prior, manifest: priorManifest });
      const a = prior.candidate.artifacts.find(a => a.artifactId === initial.artifactId && a.kind === 'export');
      if (!a || a.sha256 !== initial.sha256 || prior.candidate.revisionId !== initial.revisionId
        || prior.requirements.requirementsId !== initial.requirementsId || prior.requirements.requirementsVersion !== initial.requirementsVersion
        || prior.candidate.setupHash !== initial.setupHash || prior.candidate.sourceSha256 !== initial.sourceSha256
        || prior.candidate.checkBundleHash !== initial.checkBundleHash || prior.candidate.executionMode !== 'live') throw evidenceError();
      add('input/baseline.step', await artifacts.read(a));
      addJson('evidence/initial-acceptance.json', prior);
      addJson('evidence/initial-manifest.json', priorManifest);
    }
  } else add('input/baseline.step', await readReference(step.artifactId, r.referenceHash));
  addJson('evidence/acceptance.json', acceptance);
  addJson('evidence/manifest.json', manifest);
  addJson('evidence/requirements.json', r);
  addJson('evidence/checks.json', { contractVersion: request.contractVersion, revisionId, runId: manifest.runId,
    units: manifest.units, checkBundleHash: manifest.checkBundleHash, checks: manifest.checks });
  add('PROTOTYPE-BRIEF.txt', prototypeBrief(manifest));
  const quote = preferences(rfq);
  addJson('RFQ.json', { revisionId, manifestHash: manifest.manifestHash, preferences: quote, quoteStatus: 'Quote required', submitted: false });
  add('RFQ.txt', ['Prototype quote request template (not sent)', `Revision: ${revisionId}`, `Manifest SHA256: ${manifest.manifestHash}`,
    ...Object.entries(quote).map(([name, value]) => `${name}: ${value ?? 'Unknown'}`),
    'Preferences are user supplied, not validated manufacturing requirements or quoted commitments.',
    'Please review the supplied STEP/STL, hardware, material, finish, physical fit and intended load before quoting.',
    'Please quote unit cost, setup costs, production time, shipping and taxes separately. All currently Quote required.',
    'This is an untested physical prototype, with no selected mounting hardware. No supplier has received this request.', ''].join('\n'));
  entries.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  addJson('package.json', { contractVersion: request.contractVersion, packageKind: 'prototype_handoff', revisionId,
    runId: manifest.runId, acceptanceId: acceptance.acceptanceId, manifestId: manifest.manifestId,
    manifestHash: manifest.manifestHash, units: manifest.units, requirementsVersion: r.requirementsVersion,
    files: entries.map(e => ({ path: e.path, bytes: e.bytes.length, sha256: digest(e.bytes) })) });
  const bytes = await zip(entries);
  // No awaits after this authority check: a late archive cannot be sent as current evidence.
  store.assertCurrentExport(revisionId, identity);
  return { bytes, sha256: digest(bytes), fileName: `worldkinetics-${revisionId}-prototype.zip`, identity };
}
