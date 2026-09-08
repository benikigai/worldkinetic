"""Validate host-staged v2 identities without reserializing canonical JSON."""
import hashlib
import json
import math

REGISTRY_HASH = "593ece1f1387e766f0e80bdabc45ab6ad46c6301e8d1421f8a05d8a06f657f7d"
REGISTRY_FILE_HASH = "d9de0bbe0c6a03f101d5f9562360ac10d0a4216401533eb9be0b4148c8a9aa33"
REFERENCE_HASH = "9e5b44499ec44e06544d5a3be6a00e5659a0e74aea145afbb05f36ab3771d6a3"


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key")
        result[key] = value
    return result


def parse(raw):
    def invalid_constant(value):
        raise ValueError("Nonfinite JSON number")
    return json.loads(raw, object_pairs_hook=unique_object, parse_constant=invalid_constant)


def validate_binding(raw, length, reference_hash):
    binding = parse(raw)
    r = binding["requirements"]
    registry_text = binding["registryCanonicalJson"]
    setup_text = binding["setupCanonicalJson"]
    # Hash the original UTF-8 text, never Python's JSON representation.
    if (hashlib.sha256(registry_text.encode("utf-8")).hexdigest() != REGISTRY_HASH
            or r["registryHash"] != REGISTRY_HASH or r["registryFileSha256"] != REGISTRY_FILE_HASH
            or hashlib.sha256(setup_text.encode("utf-8")).hexdigest() != r["setupHash"]
            or r["registryCanonicalJson"] != registry_text or r["setupCanonicalJson"] != setup_text):
        raise ValueError("Canonical hash mismatch")
    registry, setup = parse(registry_text), parse(setup_text)
    if (r["contractVersion"] != "wk-prototype-0.2" or r["validatorVersion"] != "plate-validator-v1"
            or r["registryId"] != "plate_requirements_v1" or r["setupId"] not in ("resize_centered_v1", "tactile_feature_v1")
            or r["units"] != "mm" or reference_hash != REFERENCE_HASH
            or r["referenceHash"] != reference_hash or r["referenceId"] != "plate_revised_50x35x5"
            or not math.isfinite(length) or not 26 <= length <= 200):
        raise ValueError("Unsupported requirements identity")
    feature = r["setupId"] == "tactile_feature_v1"
    template = registry["setups"][r["setupId"]]
    if feature and length != 50:
        raise ValueError("Feature baseline dimensions are frozen")
    expected = {
        "setupId": r["setupId"], "registryId": registry["registryId"], "registryHash": REGISTRY_HASH,
        "units": registry["units"], "frame": registry["frame"], "referenceId": r["referenceId"],
        "referenceHash": reference_hash, "referenceHashes": registry["referenceHashes"],
        "referenceTransform": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        "dimensions": {**template["dimensions"], "lengthMm": length},
        "holes": {**template["holes"], "centersMm": [[(length-20)/2, 17.5], [(length+20)/2, 17.5]]},
        "minimumEndMaterialMm": template["minimumEndMaterialMm"], "tolerances": registry["tolerances"],
        "protectedRegions": template.get("protectedRegions"), "feature": template.get("feature"), "keepOutRegions": None, "profileId": None,
        "requiredChecks": template["requiredChecks"],
    }
    # requiredChecks has set order in the canonical contract.
    expected["requiredChecks"] = sorted(expected["requiredChecks"])
    for value in (setup, r["setup"]):
        comparison = {**value, "requiredChecks": sorted(value["requiredChecks"])}
        if comparison != expected:
            raise ValueError("Resolved setup mismatch")
    if sorted(r["requiredChecks"]) != expected["requiredChecks"]:
        raise ValueError("Required check set mismatch")
    return r
