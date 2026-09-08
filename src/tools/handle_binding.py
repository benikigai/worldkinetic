"""Check released handle canonical bytes without Python canonicalization."""
import hashlib
from requirements_binding import parse

REGISTRY_HASH = 'b71ce9b567c33e3070ada344a581777b326d313da4eab205b4878383f0d310ce'
REGISTRY_FILE_HASH = '6c1ae7ca15127d45146fc4c27e9659c206e9d7b77d1f7b925e0d7a54c60a4c7c'
DATUM_HASH = '6e6f59bda904c34ea46f336f0e1be24a2ff2de824a63cb40426988d3ac30fa83'


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def validate(raw, reference, datums, baseline=None):
    b = parse(raw)
    r = b['requirements']
    rt, st = b['registryCanonicalJson'], b['setupCanonicalJson']
    if (digest(rt.encode('utf8')) != REGISTRY_HASH or r['registryHash'] != REGISTRY_HASH
            or r['registryFileSha256'] != REGISTRY_FILE_HASH
            or r['registryCanonicalJson'] != rt or r['setupCanonicalJson'] != st
            or digest(st.encode('utf8')) != r['setupHash'] or digest(datums) != DATUM_HASH):
        raise ValueError('Handle canonical bytes mismatch')
    registry, setup = parse(rt), parse(st)
    ref = {'referenceId': 'handle_mount_v1', 'revisionId': 'handle_mount_reference_v1',
           'stepSha256': digest(reference), 'datumSpecSha256': DATUM_HASH}
    initial = r['setupId'] == 'handle_initial_v1'
    checks = registry['geometry']['requiredInitialChecks'] + ([] if initial else registry['geometry']['additionalRefinementChecks'])
    accepted = setup['acceptedInitial']
    expected = {'setupId': r['setupId'], 'registryId': 'handle_sample_v1', 'registryHash': REGISTRY_HASH,
                'units': 'mm', 'referenceId': 'handle_mount_v1', 'referenceHash': digest(reference),
                'reference': ref, 'geometry': registry['geometry'], 'acceptedInitial': accepted,
                'requiredChecks': sorted(checks)}
    if (r['contractVersion'] != 'wk-prototype-0.2' or r['validatorVersion'] != 'handle-validator-v1'
            or r['registryId'] != 'handle_sample_v1' or r['units'] != 'mm'
            or r['setupId'] not in ('handle_initial_v1', 'handle_refine_v1')
            or r['referenceId'] != ref['referenceId'] or r['referenceHash'] != digest(reference)
            or sorted(r['requiredChecks']) != sorted(checks)):
        raise ValueError('Handle identity mismatch')
    for value in (setup, r['setup']):
        if {**value, 'requiredChecks': sorted(value['requiredChecks'])} != expected:
            raise ValueError('Handle setup mismatch')
    if initial:
        if accepted is not None or baseline is not None:
            raise ValueError('Unexpected baseline')
    elif (not accepted or baseline is None or digest(baseline) != accepted['sha256']
          or accepted['revisionId'] == ref['revisionId']
          or r['requirementsVersion'] <= accepted['requirementsVersion']):
        raise ValueError('Accepted baseline binding mismatch')
    return r
