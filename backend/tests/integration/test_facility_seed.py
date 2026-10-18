"""A-01 seed against the isolated PostgreSQL test database."""

import uuid

import pytest
from db_helpers import count, insert_configuration, insert_facility, insert_workspace
from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL

import app.seed.facilities as seed_module
from app.seed.facilities import CatalogSeedError, main, seed_facilities

# Independently written expectations (not read back from FACILITIES).
EXPECTED_ROWS = {
    "fridley": {
        "name": "Power Integration Center",
        "city": "Fridley",
        "region": "MN",
        "country": "US",
        "latitude": 45.08417,
        "longitude": -93.25667,
        "is_interactive": True,
    },
    "seymour": {
        "name": "Seymour Technical Center and Engine Plant",
        "city": "Seymour",
        "region": "IN",
        "country": "US",
        "latitude": 38.95722,
        "longitude": -85.89444,
        "is_interactive": False,
    },
    "daventry": {
        "name": "Daventry Power Systems Plant",
        "city": "Daventry",
        "region": "Northamptonshire",
        "country": "GB",
        "latitude": 52.25778,
        "longitude": -1.16278,
        "is_interactive": False,
    },
}

SELECT_ALL = text(
    "SELECT id, name, city, region, country, latitude, longitude, facility_type, "
    "is_interactive, description, source_url, source_note, catalog_version "
    "FROM facility_catalog ORDER BY id"
)


def rows_by_id(db):
    return {row.id: row for row in db.execute(SELECT_ALL)}


def test_seed_inserts_exactly_the_three_facilities(db_session):
    summary = seed_facilities(db_session)
    rows = rows_by_id(db_session)

    assert summary == {"inserted": 3, "updated": 0, "unchanged": 0}
    assert set(rows) == set(EXPECTED_ROWS)
    for facility_id, expected in EXPECTED_ROWS.items():
        for column, value in expected.items():
            actual = getattr(rows[facility_id], column)
            if column in ("latitude", "longitude"):
                actual = float(actual)  # raw SQL returns NUMERIC as Decimal
            assert actual == value, (facility_id, column)
        assert rows[facility_id].catalog_version == 1
        assert rows[facility_id].source_url.startswith("https://")
        assert "approximate" in rows[facility_id].source_note.lower()


def test_only_fridley_is_interactive_in_the_database(db_session):
    seed_facilities(db_session)
    interactive = (
        db_session.execute(text("SELECT id FROM facility_catalog WHERE is_interactive"))
        .scalars()
        .all()
    )
    assert interactive == ["fridley"]


def test_seed_is_idempotent(db_session):
    seed_facilities(db_session)
    first = [tuple(row) for row in db_session.execute(SELECT_ALL)]

    summary = seed_facilities(db_session)
    second = [tuple(row) for row in db_session.execute(SELECT_ALL)]

    assert summary == {"inserted": 0, "updated": 0, "unchanged": 3}
    assert second == first
    assert count(db_session, "facility_catalog") == 3


def test_reseed_repairs_drifted_rows(db_session):
    seed_facilities(db_session)
    db_session.execute(
        text(
            "UPDATE facility_catalog SET name = 'Tampered', latitude = 0, "
            "is_interactive = true WHERE id = 'seymour'"
        )
    )

    summary = seed_facilities(db_session)
    seymour = rows_by_id(db_session)["seymour"]

    assert summary == {"inserted": 0, "updated": 1, "unchanged": 2}
    assert seymour.name == EXPECTED_ROWS["seymour"]["name"]
    assert float(seymour.latitude) == EXPECTED_ROWS["seymour"]["latitude"]
    assert seymour.is_interactive is False


def test_seed_completes_a_partially_seeded_table(db_session):
    db_session.execute(
        text(
            "INSERT INTO facility_catalog (id, name, city, region, country, latitude, "
            "longitude, facility_type, description, source_url, source_note) VALUES "
            "('fridley', 'Old', 'Fridley', 'MN', 'US', 1, 1, 'x', 'd', 'https://e.invalid', 'n')"
        )
    )
    summary = seed_facilities(db_session)
    assert summary == {"inserted": 2, "updated": 1, "unchanged": 0}
    assert count(db_session, "facility_catalog") == 3


def test_unexpected_row_aborts_before_any_change(db_session):
    insert_facility(db_session, id="unexpected")

    with pytest.raises(CatalogSeedError, match="unexpected"):
        seed_facilities(db_session)

    ids = db_session.execute(text("SELECT id FROM facility_catalog")).scalars().all()
    assert ids == ["unexpected"]


def test_seeded_fridley_can_be_referenced_by_a_configuration(db_session):
    seed_facilities(db_session)
    workspace_id = insert_workspace(db_session)

    configuration_id = insert_configuration(db_session, workspace_id, "fridley")

    assert configuration_id is not None
    assert count(db_session, "configurations") == 1


def test_seeded_facility_cannot_be_deleted_while_referenced(db_session):
    from sqlalchemy.exc import IntegrityError

    seed_facilities(db_session)
    insert_configuration(db_session, insert_workspace(db_session), "fridley")
    with pytest.raises(IntegrityError):
        db_session.execute(text("DELETE FROM facility_catalog WHERE id = 'fridley'"))


# ---------- command line ----------


def run_cli(engine, *argv):
    lines: list[str] = []
    code = main(
        list(argv), engine=engine, out=lambda *a: lines.append(" ".join(map(str, a)))
    )
    return code, "\n".join(lines)


def facility_count(engine) -> int:
    with engine.connect() as conn:
        return count(conn, "facility_catalog")


def test_cli_dry_run_writes_nothing_and_does_not_connect(committing_engine):
    class NoConnectEngine:
        url = committing_engine.url

        def connect(self, *a, **k):
            raise AssertionError("dry run must not connect")

        def __getattr__(self, name):
            raise AssertionError(f"dry run must not use the engine ({name})")

    code, output = run_cli(NoConnectEngine())
    assert code == 0
    assert "Dry run" in output
    assert "--apply" in output
    assert facility_count(committing_engine) == 0


def test_cli_apply_seeds_a_local_database(committing_engine):
    code, output = run_cli(committing_engine, "--apply")

    assert code == 0
    assert "3 inserted" in output
    assert facility_count(committing_engine) == 3

    code, output = run_cli(committing_engine, "--apply")
    assert code == 0
    assert "3 unchanged" in output
    assert facility_count(committing_engine) == 3


def test_cli_output_never_contains_credentials_or_urls(committing_engine):
    marker = "pw-marker-9f3a"
    url = committing_engine.url.set(password=marker)
    probe = create_engine(url)  # not connected: only used for its URL

    outputs = [run_cli(probe)[1]]
    outputs.append(run_cli(probe, "--apply", "--confirm-host", "elsewhere")[1])
    remote = create_engine(url.set(host="db.example.invalid"))
    outputs.append(run_cli(remote, "--apply")[1])

    for output in outputs:
        assert marker not in output
        assert "postgresql" not in output
        assert "gridproof:" not in output
    probe.dispose()
    remote.dispose()


def test_cli_refuses_remote_apply_without_matching_host_confirmation():
    remote = create_engine(
        URL.create(
            "postgresql+psycopg", "u", "secret-pw", "db.example.invalid", 5432, "app"
        )
    )
    for argv in (["--apply"], ["--apply", "--confirm-host", "other.example.invalid"]):
        code, output = run_cli(remote, *argv)
        assert code == 2
        assert "Refusing" in output
        assert "secret-pw" not in output
    remote.dispose()


def test_cli_remote_with_matching_confirmation_proceeds_and_fails_safely():
    # Nothing listens here: the connection fails, and the error must not leak details.
    remote = create_engine(
        URL.create(
            "postgresql+psycopg", "u", "secret-pw", "localhost.invalid", 5432, "app"
        ),
        connect_args={"connect_timeout": 2},
    )
    code, output = run_cli(remote, "--apply", "--confirm-host", "localhost.invalid")
    assert code == 1
    assert "OperationalError" in output
    assert "rolled back" in output
    assert "secret-pw" not in output
    assert "localhost.invalid:" not in output
    remote.dispose()


def test_cli_failure_after_the_upsert_rolls_everything_back(
    committing_engine, monkeypatch
):
    def boom(session):
        raise CatalogSeedError("simulated failure after the upsert")

    monkeypatch.setattr(seed_module, "_verify_expected_ids", boom)

    code, output = run_cli(committing_engine, "--apply")

    assert code == 1
    assert "rolled back" in output
    assert facility_count(committing_engine) == 0


def test_cli_database_error_is_credential_safe(committing_engine):
    marker = "pw-marker-1c7e"
    bad = create_engine(
        committing_engine.url.set(
            password=marker, database="no_such_db_" + uuid.uuid4().hex[:8]
        ),
        connect_args={"connect_timeout": 3},
    )
    code, output = run_cli(bad, "--apply")
    assert code == 1
    assert marker not in output
    assert "Details withheld" in output
    bad.dispose()
