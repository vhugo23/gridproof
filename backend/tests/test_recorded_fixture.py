"""The frontend's recorded-demo fixture must equal what the simulator produces now.

The fixture (frontend/src/lib/recorded/startup-check-5s-vs-15s.json) is the labeled
"recorded demo" fallback. It is generated from `run_startup_check`, never written by
hand, and this test fails if the simulator changes without regenerating it.

Regenerate with:  GRIDPROOF_REGEN_FIXTURE=1 python -m pytest tests/test_recorded_fixture.py
"""

import copy
import json
import os
from pathlib import Path

from app.domain.startup_check import EvidenceSource, run_startup_check
from app.domain.system_config import default_system_config, from_snapshot, to_snapshot

FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "frontend"
    / "src"
    / "lib"
    / "recorded"
    / "startup-check-5s-vs-15s.json"
)
CONFIGURATION_ID = "00000000-0000-4000-8000-0000000000c1"


def _evidence(version: int, delay: int) -> dict:
    data = copy.deepcopy(to_snapshot(default_system_config()))
    data["equipment"]["g1"]["startup_delay_s"] = delay
    source = EvidenceSource(
        configuration_id=CONFIGURATION_ID,
        version_id=f"00000000-0000-4000-8000-{version:012d}",
        version_number=version,
        schema_version="config-v1",
    )
    return json.loads(run_startup_check(from_snapshot(data), source).model_dump_json())


def _expected() -> dict:
    return {
        "recorded": True,
        "generated_by": "backend/tests/test_recorded_fixture.py via run_startup_check",
        "baseline": _evidence(1, 5),
        "modified": _evidence(2, 15),
    }


def test_recorded_fixture_matches_the_simulator():
    expected = _expected()
    if os.environ.get("GRIDPROOF_REGEN_FIXTURE") == "1":
        FIXTURE.write_text(json.dumps(expected, indent=2) + "\n", encoding="utf-8")
    assert json.loads(FIXTURE.read_text(encoding="utf-8")) == expected


def test_recorded_fixture_holds_the_verified_demonstration_values():
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    base, mod = fixture["baseline"], fixture["modified"]
    assert base["metrics"]["battery_bridge_energy_kwh"] == 0.25
    assert mod["metrics"]["battery_bridge_energy_kwh"] == 0.75
    status = {r["requirement_id"]: r["status"] for r in mod["requirements"]}
    assert status == {"G1_READY_WITHIN_10S": "fail", "CRITICAL_LOAD_CONTINUITY": "pass"}
