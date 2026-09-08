"""Handle staging through the existing locked, bounded runtime."""
import json
from datetime import datetime, timezone
from cad_runner import CoreError, HERE, MAX_BYTES, audit, read_regular, safe_path, sha
from handle_binding import DATUM_HASH, REGISTRY_HASH, validate

REFERENCE_SOURCE = b"""from build123d import Align, Compound, Cylinder, Pos, export_step
pads = [Pos(x,0,0) * Cylinder(7,2,align=(Align.CENTER,Align.CENTER,Align.MIN)) for x in (-48,48)]
export_step(Compound(children=pads), '/out/candidate.step')
"""


def deliver(output, artifacts, runtime):
    if sum(map(len, artifacts.values())) > MAX_BYTES:
        raise CoreError('EXPORT_FAILED', 'Total output exceeds limit')
    runtime.remaining()
    output.mkdir(mode=0o700)
    try:
        for name, data in artifacts.items():
            with (output / name).open('xb') as stream:
                stream.write(data)
            (output / name).chmod(0o444)
        audit(output, artifacts)
    except BaseException:
        for name in artifacts:
            (output / name).unlink(missing_ok=True)
        output.rmdir()
        raise


def fresh_output(value):
    output = safe_path(value)
    if output.exists() or not output.parent.is_dir():
        raise CoreError('INVALID_PARAMETERS', 'Fresh output directory required')
    return output


def trusted_files():
    return {name: (HERE / name).read_bytes() for name in
            ('handle_geometry.py', 'handle_mesh.py', 'mesh_checks.py', 'handle_binding.py', 'requirements_binding.py')}


def create_reference(args, runtime):
    started_at = datetime.now(timezone.utc).isoformat()
    output = fresh_output(args.output_dir)
    datums = read_regular(safe_path(args.datums_file))
    if sha(datums) != DATUM_HASH:
        raise CoreError('EVIDENCE_CONFLICT', 'Canonical datum mismatch')
    engine = runtime.inspect_image()
    generated = runtime.stage('generator', {'source.py': REFERENCE_SOURCE}, {'candidate.step'})
    inputs = {**trusted_files(), 'verify.py': (HERE / 'handle_verify.py').read_bytes(),
              'reference.step': generated['candidate.step'], 'datums.json': datums,
              'config.json': json.dumps({'referenceOnly': True, 'referenceSha256': sha(generated['candidate.step'])}).encode()}
    first = runtime.stage('verifier', inputs, {'preview.stl', 'measurement.json'})
    final = runtime.stage('export_verifier', {**inputs, 'preview.stl': first['preview.stl']}, {'measurement.json'})
    report = json.loads(final['measurement.json'])
    if not report['reference']['passed'] or not report['mesh']['passed']:
        raise CoreError('CHECK_FAILED', 'Trusted reference failed independent reopen')
    artifacts = {'reference.step': generated['candidate.step'], 'preview.stl': first['preview.stl'], 'datums.json': datums}
    result = {'engine': engine, 'measurement': report, 'stages': runtime.stages,
              'startedAt': started_at, 'completedAt': datetime.now(timezone.utc).isoformat(),
              'verifierSha256': {n: sha(b) for n, b in inputs.items() if n.endswith('.py')},
              'artifacts': [{'name': n, 'sha256': sha(b), 'bytes': len(b)} for n, b in artifacts.items()]}
    artifacts['provenance.json'] = json.dumps(result, indent=2, allow_nan=False).encode()
    deliver(output, artifacts, runtime)
    return result


def execute_handle(args, runtime):
    started_at = datetime.now(timezone.utc).isoformat()
    output = fresh_output(args.output_dir)
    ref = read_regular(safe_path(args.reference_step))
    datums = read_regular(safe_path(args.datums_file))
    baseline = read_regular(safe_path(args.baseline_step)) if args.baseline_step else None
    binding = read_regular(safe_path(args.requirements_json), 128*1024)
    try:
        r = validate(binding, ref, datums, baseline)
        if sha(ref) != args.reference_sha256:
            raise ValueError('Reference hash mismatch')
    except (ValueError, KeyError, TypeError) as exc:
        raise CoreError('EVIDENCE_CONFLICT', 'Handle binding mismatch') from exc
    if not args.source_file:
        raise CoreError('INVALID_PARAMETERS', 'Handle requires source')
    source = read_regular(safe_path(args.source_file), 65536)
    source.decode('utf8', errors='strict')
    engine = runtime.inspect_image()
    inputs = {'source.py': source, 'reference.step': ref, 'datums.json': datums}
    if baseline is not None:
        inputs['baseline.step'] = baseline
    generated = runtime.stage('generator', inputs, {'candidate.step'})
    regenerated = runtime.stage('regenerator', inputs, {'candidate.step'})
    config = {'geometryHash': sha(generated['candidate.step']), 'regeneratedSha256': sha(regenerated['candidate.step']),
              'referenceSha256': sha(ref), 'sourceSha256': sha(source)}
    trusted = {**trusted_files(), 'verify.py': (HERE / 'handle_verify.py').read_bytes(),
               'candidate.step': generated['candidate.step'], 'regenerated.step': regenerated['candidate.step'],
               'reference.step': ref, 'datums.json': datums, 'requirements.json': binding,
               'config.json': json.dumps(config).encode()}
    if baseline is not None:
        trusted['baseline.step'] = baseline
    first = runtime.stage('verifier', trusted, {'measurement.json', 'preview.stl'})
    final = runtime.stage('export_verifier', {**trusted, 'preview.stl': first['preview.stl'],
                                            'checked.step': generated['candidate.step']}, {'measurement.json'})
    a, b = json.loads(first['measurement.json']), json.loads(final['measurement.json'])
    if a['engine'] != b['engine'] or a['engine'] != {'version': engine['version'], 'ocpVersion': engine['ocpVersion']}:
        raise CoreError('TOOL_UNAVAILABLE', 'Measured engine mismatch')
    checks = a['checks'] + b['checks']
    result = {'executionMode': 'live', 'scope': 'python_source_handle', 'setupId': r['setupId'],
              'registrySha256': REGISTRY_HASH, 'units': 'mm', 'lengthMm': None, 'sourceSha256': sha(source),
              'geometryHash': config['geometryHash'], 'referenceSha256': sha(ref), 'engine': engine,
              'checks': checks, 'stages': runtime.stages, 'accepted': False, 'physicallyTested': False,
              'startedAt': started_at, 'completedAt': datetime.now(timezone.utc).isoformat(),
              'verifierSha256': {n: sha(b) for n, b in trusted.items() if n.endswith('.py')},
              'status': 'checked' if all(c['state'] == 'passed' for c in checks) else 'check_failed'}
    artifacts = {'source.py': source, 'editable.py': source, 'candidate.step': generated['candidate.step'], 'preview.stl': first['preview.stl']}
    result['artifacts'] = [{'name': n, 'sha256': sha(b), 'bytes': len(b)} for n, b in artifacts.items()]
    artifacts['result.json'] = json.dumps(result, indent=2, allow_nan=False).encode()
    deliver(output, artifacts, runtime)
    return result
