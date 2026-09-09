"""Fresh trusted verifier entry point. Generated source is never mounted here."""
import importlib.metadata
import json
from pathlib import Path
from build123d import import_step
from handle_export import export_handle_stl_or_exit
from handle_binding import DATUM_HASH, digest, validate
from handle_geometry import reference_measurement, inspect, compare, record, solid_measurement
from handle_mesh import inspect_mesh

ROOT = Path('/input')
config = json.loads((ROOT / 'config.json').read_bytes())
ref_bytes = (ROOT / 'reference.step').read_bytes()
datums = (ROOT / 'datums.json').read_bytes()
if digest(ref_bytes) != config['referenceSha256'] or digest(datums) != DATUM_HASH:
    raise ValueError('Reference bytes changed')
reference = import_step(ROOT / 'reference.step')
ref = reference_measurement(reference)
if not ref['passed']:
    raise ValueError('Reference is not the trusted two-pad geometry')
engine = {'version': importlib.metadata.version('build123d'), 'ocpVersion': importlib.metadata.version('cadquery-ocp-novtk')}
result = {'engine': engine, 'reference': ref, 'checks': []}
if config.get('referenceOnly'):
    if (ROOT / 'preview.stl').exists():
        result['mesh'] = inspect_mesh(ROOT / 'preview.stl', ref, reference_only=True)
    else:
        result['meshing'] = export_handle_stl_or_exit(reference, '/out/preview.stl', '/out/measurement.json')
else:
    baseline_bytes = (ROOT / 'baseline.step').read_bytes() if (ROOT / 'baseline.step').exists() else None
    r = validate((ROOT / 'requirements.json').read_bytes(), ref_bytes, datums, baseline_bytes)
    for name, key in [('candidate.step','geometryHash'), ('regenerated.step','regeneratedSha256')]:
        if digest((ROOT / name).read_bytes()) != config[key]:
            raise ValueError('Sealed geometry bytes changed')
    shape = import_step(ROOT / 'candidate.step')
    regenerated = import_step(ROOT / 'regenerated.step')
    baseline = import_step(ROOT / 'baseline.step') if baseline_bytes is not None else None
    g, initial = r['setup']['geometry'], r['setupId'] == 'handle_initial_v1'
    checks = inspect(shape, reference, g, baseline, initial)
    if not (ROOT / 'checked.step').exists():
        result['checks'] = checks
        result['meshing'] = export_handle_stl_or_exit(shape, '/out/preview.stl', '/out/measurement.json')
    else:
        if digest((ROOT / 'checked.step').read_bytes()) != config['geometryHash']:
            raise ValueError('Export byte identity mismatch')
        checked = import_step(ROOT / 'checked.step')
        step = compare(shape, checked, reference, g, baseline, initial)
        step['sha256'] = config['geometryHash']
        editable = compare(shape, regenerated, reference, g, baseline, initial)
        editable.update({'sourceSha256': config['sourceSha256'], 'regeneratedSha256': config['regeneratedSha256']})
        mesh = inspect_mesh(ROOT / 'preview.stl', solid_measurement(shape), step_checks=checks)
        result['checks'] = [record('export.step_reopen', step), record('export.editable_reopen', editable), record('export.stl_reopen', mesh)]
Path('/out/measurement.json').write_text(json.dumps(result, allow_nan=False))
