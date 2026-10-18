"""SystemConfigV1 schema behavior. These tests need no database."""

import copy
import json

import pytest
from pydantic import BaseModel, ValidationError

from app.domain.system_config import (
    DEFAULT_CONFIGURATION_NAME,
    SCHEMA_VERSION,
    Battery,
    Equipment,
    Generator,
    Load,
    Switchgear,
    SystemConfigV1,
    UnsupportedSchemaVersion,
    Utility,
    default_system_config,
    from_snapshot,
    load_snapshot,
    to_snapshot,
    validation_details,
)

# Independent literal copied from docs/05-api-contracts.md (SystemConfigV1 example).
DOC_EXAMPLE = {
    "facility_id": "fridley",
    "equipment": {
        "g1": {"rated_kw": 250, "startup_delay_s": 5, "enabled": True},
        "g2": {"rated_kw": 250, "startup_delay_s": 5, "enabled": True},
        "battery": {
            "inverter_kw": 250,
            "usable_kwh": 500,
            "initial_soc_pct": 80,
            "min_soc_pct": 20,
        },
        "utility": {"available": True},
        "switchgear": {"mode": "auto"},
        "load": {"critical_kw": 180},
    },
}


def modified(path: str, value):
    """A copy of the example with one dotted path replaced (or removed)."""
    data = copy.deepcopy(DOC_EXAMPLE)
    *parents, leaf = path.split(".")
    node = data
    for part in parents:
        node = node[part]
    if value is REMOVE:
        del node[leaf]
    else:
        node[leaf] = value
    return data


REMOVE = object()


def details_for(data):
    with pytest.raises(ValidationError) as exc:
        from_snapshot(data)
    return validation_details(exc.value)


# ---------- contract conformance ----------


def test_default_config_equals_the_documented_example():
    assert to_snapshot(default_system_config()) == DOC_EXAMPLE


def test_constants():
    assert SCHEMA_VERSION == "config-v1"
    assert DEFAULT_CONFIGURATION_NAME == "Fridley Test Configuration"


def test_snapshot_round_trip_is_lossless():
    config = default_system_config()
    assert from_snapshot(to_snapshot(config)) == config


def test_snapshot_is_deterministic_json():
    first = json.dumps(to_snapshot(default_system_config()), sort_keys=True)
    second = json.dumps(to_snapshot(default_system_config()), sort_keys=True)
    assert first == second
    assert json.loads(first) == DOC_EXAMPLE


def test_snapshot_is_a_fresh_copy():
    config = default_system_config()
    snapshot = to_snapshot(config)
    snapshot["equipment"]["g1"]["startup_delay_s"] = 99
    assert config.equipment.g1.startup_delay_s == 5
    assert to_snapshot(config)["equipment"]["g1"]["startup_delay_s"] == 5


def test_g1_startup_delay_defaults_to_the_showcase_baseline():
    assert default_system_config().equipment.g1.startup_delay_s == 5


# ---------- accepted values ----------


@pytest.mark.parametrize(
    "path,value",
    [
        ("equipment.g1.startup_delay_s", 0),
        ("equipment.g1.startup_delay_s", 15),
        ("equipment.g1.startup_delay_s", 120),
        ("equipment.g2.startup_delay_s", 120),
        ("equipment.g1.enabled", False),
        ("equipment.g2.enabled", False),
        ("equipment.battery.initial_soc_pct", 20),
        ("equipment.battery.initial_soc_pct", 100),
        ("equipment.load.critical_kw", 1),
        ("equipment.load.critical_kw", 500),
    ],
)
def test_valid_edits_are_accepted(path, value):
    config = from_snapshot(modified(path, value))
    assert to_snapshot(config) != DOC_EXAMPLE
    assert to_snapshot(config) == modified(path, value)


def test_the_showcase_edit_changes_only_g1():
    config = from_snapshot(modified("equipment.g1.startup_delay_s", 15))
    assert config.equipment.g1.startup_delay_s == 15
    assert config.equipment.g2.startup_delay_s == 5


def test_json_input_is_validated_the_same_way():
    text = json.dumps(modified("equipment.g1.startup_delay_s", 15))
    assert SystemConfigV1.model_validate_json(text).equipment.g1.startup_delay_s == 15


# ---------- rejected values ----------

WHOLE = "Must be a whole number"


@pytest.mark.parametrize(
    "path,value,reason",
    [
        # startup delay
        ("equipment.g1.startup_delay_s", -1, "Must be between 0 and 120"),
        ("equipment.g1.startup_delay_s", 121, "Must be between 0 and 120"),
        ("equipment.g2.startup_delay_s", 10**9, "Must be between 0 and 120"),
        # initial SOC
        (
            "equipment.battery.initial_soc_pct",
            19,
            "Must be at least the minimum SOC (20)",
        ),
        (
            "equipment.battery.initial_soc_pct",
            0,
            "Must be at least the minimum SOC (20)",
        ),
        ("equipment.battery.initial_soc_pct", 101, "Must be between 0 and 100"),
        ("equipment.battery.initial_soc_pct", -1, "Must be between 0 and 100"),
        # critical load
        ("equipment.load.critical_kw", 0, "Must be between 1 and 500"),
        ("equipment.load.critical_kw", 501, "Must be between 1 and 500"),
        ("equipment.load.critical_kw", -5, "Must be between 1 and 500"),
        # fixed values
        ("equipment.g1.rated_kw", 300, "Must be 250 (fixed in V1)"),
        ("equipment.g2.rated_kw", 0, "Must be 250 (fixed in V1)"),
        ("equipment.battery.inverter_kw", 251, "Must be 250 (fixed in V1)"),
        ("equipment.battery.usable_kwh", 501, "Must be 500 (fixed in V1)"),
        ("equipment.battery.min_soc_pct", 30, "Must be 20 (fixed in V1)"),
        ("equipment.battery.min_soc_pct", 0, "Must be 20 (fixed in V1)"),
        ("equipment.utility.available", False, "Must be true (fixed in V1)"),
        ("equipment.utility.available", "true", "Must be true (fixed in V1)"),
        ("equipment.utility.available", 1, "Must be true (fixed in V1)"),
        ("equipment.switchgear.mode", "manual", "Must be 'auto' (fixed in V1)"),
        ("equipment.switchgear.mode", "AUTO", "Must be 'auto' (fixed in V1)"),
        ("equipment.switchgear.mode", "", "Must be 'auto' (fixed in V1)"),
        ("equipment.switchgear.mode", 5, "Must be 'auto' (fixed in V1)"),
        ("facility_id", "seymour", "Must be 'fridley' (fixed in V1)"),
        ("facility_id", None, "Must be 'fridley' (fixed in V1)"),
        # booleans for the editable flags
        ("equipment.g1.enabled", "yes", "Must be true or false"),
        ("equipment.g1.enabled", "true", "Must be true or false"),
        ("equipment.g2.enabled", 1, "Must be true or false"),
        ("equipment.g2.enabled", 0, "Must be true or false"),
        ("equipment.g1.enabled", None, "Must be true or false"),
    ],
)
def test_invalid_values_are_rejected_with_a_field_specific_reason(path, value, reason):
    assert details_for(modified(path, value)) == [{"field": path, "reason": reason}]


INTEGER_PATHS = [
    "equipment.g1.startup_delay_s",
    "equipment.g2.startup_delay_s",
    "equipment.battery.initial_soc_pct",
    "equipment.load.critical_kw",
    "equipment.g1.rated_kw",
    "equipment.g2.rated_kw",
    "equipment.battery.inverter_kw",
    "equipment.battery.usable_kwh",
    "equipment.battery.min_soc_pct",
]


@pytest.mark.parametrize("path", INTEGER_PATHS)
@pytest.mark.parametrize(
    "value",
    [
        True,
        False,
        5.5,
        5.0,
        250.0,
        "5",
        "",
        None,
        float("nan"),
        float("inf"),
        float("-inf"),
        [5],
        {"v": 5},
    ],
    ids=lambda v: repr(v),
)
def test_only_real_integers_are_accepted_for_integer_fields(path, value):
    details = details_for(modified(path, value))
    assert details == [{"field": path, "reason": WHOLE}]


def test_json_booleans_and_decimals_are_not_integers():
    for bad in ("true", "5.0", "5.5", '"5"', "null", "1e999"):
        text = json.dumps(DOC_EXAMPLE).replace(
            '"startup_delay_s": 5', f'"startup_delay_s": {bad}', 1
        )
        with pytest.raises(ValidationError):
            SystemConfigV1.model_validate_json(text)


@pytest.mark.parametrize(
    "data,field,reason",
    [
        ({**DOC_EXAMPLE, "extra": 1}, "extra", "Unknown field"),
        (modified("equipment.g3", {"rated_kw": 250}), "equipment.g3", "Unknown field"),
        (modified("equipment.g1.fuel", "diesel"), "equipment.g1.fuel", "Unknown field"),
        (
            modified("equipment.battery.chemistry", "x"),
            "equipment.battery.chemistry",
            "Unknown field",
        ),
        (
            modified("equipment.load.load_bank_kw", 10),
            "equipment.load.load_bank_kw",
            "Unknown field",
        ),
        (modified("equipment.g2", REMOVE), "equipment.g2", "Required"),
        (modified("equipment.battery", REMOVE), "equipment.battery", "Required"),
        (
            modified("equipment.g1.startup_delay_s", REMOVE),
            "equipment.g1.startup_delay_s",
            "Required",
        ),
        (
            modified("equipment.battery.min_soc_pct", REMOVE),
            "equipment.battery.min_soc_pct",
            "Required",
        ),
        (modified("facility_id", REMOVE), "facility_id", "Required"),
        (modified("equipment", REMOVE), "equipment", "Required"),
        (modified("equipment.g1", "g1"), "equipment.g1", "Must be an object"),
        (modified("equipment", []), "equipment", "Must be an object"),
    ],
    ids=lambda v: v if isinstance(v, str) else "",
)
def test_structural_errors(data, field, reason):
    assert details_for(data) == [{"field": field, "reason": reason}]


@pytest.mark.parametrize("data", [None, [], "text", 5, True])
def test_non_object_input_is_rejected_at_the_root(data):
    assert details_for(data) == [{"field": "(root)", "reason": "Must be an object"}]


def test_equipment_ids_must_be_exactly_the_v1_set():
    data = modified("equipment.g3", copy.deepcopy(DOC_EXAMPLE["equipment"]["g1"]))
    assert details_for(data) == [{"field": "equipment.g3", "reason": "Unknown field"}]
    data = modified("equipment.g1", REMOVE)
    assert details_for(data) == [{"field": "equipment.g1", "reason": "Required"}]


def test_generator_ids_are_case_sensitive():
    data = copy.deepcopy(DOC_EXAMPLE)
    data["equipment"]["G1"] = data["equipment"].pop("g1")
    fields = {d["field"]: d["reason"] for d in details_for(data)}
    assert fields == {"equipment.G1": "Unknown field", "equipment.g1": "Required"}


# ---------- error details ----------


def test_several_errors_are_all_reported():
    data = modified("equipment.g1.startup_delay_s", 500)
    data["equipment"]["load"]["critical_kw"] = 0
    data["equipment"]["battery"]["initial_soc_pct"] = 19
    reported = {d["field"]: d["reason"] for d in details_for(data)}
    assert reported == {
        "equipment.g1.startup_delay_s": "Must be between 0 and 120",
        "equipment.load.critical_kw": "Must be between 1 and 500",
        "equipment.battery.initial_soc_pct": "Must be at least the minimum SOC (20)",
    }


@pytest.mark.parametrize(
    "path",
    [
        "equipment.g1.startup_delay_s",
        "equipment.g1.enabled",
        "equipment.switchgear.mode",
        "equipment.battery.min_soc_pct",
        "facility_id",
    ],
)
def test_details_never_echo_the_submitted_value(path):
    secret = "s3cret-VALUE-9f2"
    details = details_for(modified(path, secret))
    assert secret not in json.dumps(details)
    assert all(set(item) == {"field", "reason"} for item in details)


def test_unknown_field_name_is_reported_but_not_its_value():
    data = modified("equipment.g1.password", "s3cret-VALUE-9f2")
    details = details_for(data)
    assert details == [{"field": "equipment.g1.password", "reason": "Unknown field"}]


def test_unrecognized_error_types_use_the_safe_fallback():
    class Probe(BaseModel):
        value: int

    with pytest.raises(ValidationError) as exc:
        Probe.model_validate({"value": "not-a-number-s3cret"})
    details = validation_details(exc.value)
    assert details == [{"field": "value", "reason": "Invalid value"}]


# ---------- immutability ----------


def test_models_are_frozen_at_every_level():
    config = default_system_config()
    for target, attribute, value in [
        (config, "facility_id", "seymour"),
        (config.equipment, "g1", None),
        (config.equipment.g1, "startup_delay_s", 99),
        (config.equipment.battery, "initial_soc_pct", 50),
        (config.equipment.utility, "available", False),
        (config.equipment.switchgear, "mode", "manual"),
        (config.equipment.load, "critical_kw", 1),
    ]:
        with pytest.raises(ValidationError, match="frozen"):
            setattr(target, attribute, value)


def test_models_hold_no_mutable_containers():
    mutable = (list, dict, set, bytearray)
    models = [SystemConfigV1, Equipment, Generator, Battery, Utility, Switchgear, Load]
    for model in models:
        for name, field in model.model_fields.items():
            annotation = field.annotation
            origin = getattr(annotation, "__origin__", annotation)
            assert not (isinstance(origin, type) and issubclass(origin, mutable)), (
                model,
                name,
            )
    config = default_system_config()
    for node in (
        config,
        config.equipment,
        config.equipment.g1,
        config.equipment.battery,
    ):
        assert not any(isinstance(v, mutable) for v in vars(node).values())


def test_configs_are_hashable_and_compare_by_value():
    first, second = default_system_config(), default_system_config()
    assert first == second
    assert hash(first) == hash(second)
    changed = from_snapshot(modified("equipment.g1.startup_delay_s", 15))
    assert changed != first
    assert len({first, second, changed}) == 2


def test_changing_a_value_builds_a_new_object_and_leaves_the_original():
    original = default_system_config()
    changed = original.model_copy(deep=True)
    assert changed is not original
    assert original.equipment.g1.startup_delay_s == 5


def test_generators_are_independent_objects():
    config = default_system_config()
    assert config.equipment.g1 == config.equipment.g2
    assert config.equipment.g1 is not config.equipment.g2


# ---------- explicit schema-version handling ----------


def test_load_snapshot_accepts_the_implemented_version():
    config = load_snapshot("config-v1", DOC_EXAMPLE)
    assert config == default_system_config()


@pytest.mark.parametrize(
    "version", ["config-v2", "config-v0", "", "CONFIG-V1", "config-v1 ", "v1"]
)
def test_load_snapshot_rejects_other_versions_even_for_valid_data(version):
    with pytest.raises(UnsupportedSchemaVersion):
        load_snapshot(version, DOC_EXAMPLE)


def test_load_snapshot_still_validates_the_data_for_the_supported_version():
    with pytest.raises(ValidationError):
        load_snapshot("config-v1", modified("equipment.g1.startup_delay_s", 500))
