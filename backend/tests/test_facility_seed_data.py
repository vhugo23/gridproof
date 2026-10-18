"""Seed data and validation rules. These tests need no database."""

import pytest
from pydantic import ValidationError

from app.db.models import FacilityCatalog
from app.seed.facilities import (
    FACILITIES,
    CatalogSeedError,
    FacilitySeed,
    validate_catalog,
)

# Independently written from the public sources recorded in docs/08-decisions.md
# (city coordinates: Wikipedia city entries, decimal degrees).
EXPECTED = {
    "fridley": (45.08417, -93.25667, "US", True),
    "seymour": (38.95722, -85.89444, "US", False),
    "daventry": (52.25778, -1.16278, "GB", False),
}


def make(**overrides) -> FacilitySeed:
    data = FACILITIES[0].model_dump()
    data.update(overrides)
    return FacilitySeed(**data)


def test_exactly_the_three_expected_facilities():
    assert {row.id for row in FACILITIES} == set(EXPECTED)
    assert len(FACILITIES) == 3


def test_coordinates_country_and_interactivity_match_sources():
    for row in FACILITIES:
        latitude, longitude, country, interactive = EXPECTED[row.id]
        assert (row.latitude, row.longitude) == (latitude, longitude)
        assert row.country == country
        assert row.is_interactive is interactive


def test_only_fridley_is_interactive():
    assert [row.id for row in FACILITIES if row.is_interactive] == ["fridley"]


def test_shipped_catalog_is_valid():
    validate_catalog(FACILITIES)


def test_source_urls_are_https_and_distinct_per_site():
    urls = [row.source_url for row in FACILITIES]
    assert all(url.startswith("https://") for url in urls)
    assert len(set(urls)) == 3


def test_precision_limitation_is_stored_with_every_row():
    for row in FACILITIES:
        assert "approximate" in row.source_note.lower()
        assert "not the facility's coordinates" in row.source_note
        assert "not affiliated with Cummins" in row.source_note


def test_fridley_states_that_the_lab_is_fictional():
    fridley = next(row for row in FACILITIES if row.id == "fridley")
    assert "fictional" in fridley.description
    assert "synthetic" in fridley.description


def test_no_row_claims_live_or_operational_data():
    banned = ("live", "real-time", "telemetry", "kw", "uptime", "status:")
    for row in FACILITIES:
        text = f"{row.description} {row.source_note}".lower()
        assert not any(word in text for word in banned), row.id


def test_row_limits_match_database_columns():
    table = FacilityCatalog.__table__
    for column in ("id", "name", "city", "region", "country", "facility_type"):
        limit = table.c[column].type.length
        for row in FACILITIES:
            assert len(getattr(row, column)) <= limit, (row.id, column)


def test_every_table_column_is_seeded_with_a_value():
    assert set(FacilitySeed.model_fields) == {
        c.name for c in FacilityCatalog.__table__.c
    }


@pytest.mark.parametrize(
    "overrides",
    [
        {"latitude": 90.5},
        {"latitude": -90.5},
        {"longitude": 180.5},
        {"longitude": -180.5},
        {"latitude": 45.1234567},
        {"longitude": float("nan")},
        {"latitude": float("inf")},
        {"source_url": "http://www.cummins.com/page"},
        {"source_url": "https://"},
        {"source_url": "not a url"},
        {"description": ""},
        {"description": "   "},
        {"source_note": ""},
        {
            "source_note": "Position is exact. Independent prototype; not affiliated with Cummins."
        },
        {"source_note": "Marker position is approximate."},
        {"name": "x" * 161},
        {"city": "x" * 121},
        {"id": "x" * 41},
        {"id": "Fridley"},
        {"id": "1fridley"},
        {"facility_type": "Integration Testing"},
        {"catalog_version": 0},
        {"unknown_field": "x"},
    ],
    ids=lambda o: next(iter(o)) + "=" + str(next(iter(o.values())))[:20],
)
def test_row_validation_rejects(overrides):
    with pytest.raises(ValidationError):
        make(**overrides)


def test_boundary_coordinates_with_six_decimals_are_accepted():
    row = make(latitude=-90.0, longitude=180.0)
    assert (row.latitude, row.longitude) == (-90.0, 180.0)
    assert make(latitude=12.123456).latitude == 12.123456


def rows_with(**changes) -> list[FacilitySeed]:
    rows = []
    for row in FACILITIES:
        rows.append(row.model_copy(update=changes.get(row.id, {})))
    return rows


@pytest.mark.parametrize(
    "rows",
    [
        list(FACILITIES[:2]),
        list(FACILITIES) + [make(id="extra")],
        [FACILITIES[0], FACILITIES[0], FACILITIES[2]],
        rows_with(seymour={"is_interactive": True}),
        rows_with(fridley={"is_interactive": False}),
        [make(id="fridley"), make(id="seymour"), make(id="other")],
    ],
    ids=[
        "missing-one",
        "extra-one",
        "duplicate-id",
        "two-interactive",
        "none-interactive",
        "wrong-id-set",
    ],
)
def test_catalog_validation_rejects(rows):
    with pytest.raises(CatalogSeedError):
        validate_catalog(rows)
