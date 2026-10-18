"""Seed the public facility catalog (roadmap task A-01).

Three public facility records, written with an idempotent PostgreSQL upsert.
All content is public context only: no telemetry, no equipment inventory, no
operating conditions. Marker positions are approximate city locations, not the
coordinates of any plant.

Command line (dry run by default; nothing is written without --apply):

    python -m app.seed.facilities
    python -m app.seed.facilities --apply
    python -m app.seed.facilities --apply --confirm-host <remote host>

A remote (non-loopback) database additionally requires --confirm-host with the
exact target host name. Connection URLs and passwords are never printed.
"""

import argparse
import sys
from collections.abc import Callable, Sequence
from decimal import Decimal
from typing import Any
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db.models import FacilityCatalog

EXPECTED_IDS = frozenset({"fridley", "seymour", "daventry"})
INTERACTIVE_ID = "fridley"
LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})

NOT_AFFILIATED = "Independent prototype; not affiliated with Cummins."


class CatalogSeedError(Exception):
    """The seed data or the database state is not acceptable."""


class FacilitySeed(BaseModel):
    """One catalog row. Limits mirror the facility_catalog columns."""

    model_config = ConfigDict(frozen=True, extra="forbid", str_strip_whitespace=True)

    id: str = Field(pattern=r"^[a-z][a-z0-9_-]{1,39}$")
    name: str = Field(min_length=1, max_length=160)
    city: str = Field(min_length=1, max_length=120)
    region: str = Field(min_length=1, max_length=120)
    country: str = Field(min_length=1, max_length=120)
    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)
    facility_type: str = Field(pattern=r"^[a-z][a-z0-9_]{1,79}$")
    is_interactive: bool
    description: str = Field(min_length=1)
    source_url: str = Field(min_length=1)
    source_note: str = Field(min_length=1)
    catalog_version: int = Field(ge=1)

    @field_validator("latitude", "longitude")
    @classmethod
    def _at_most_six_decimals(cls, value: float) -> float:
        # facility_catalog stores NUMERIC(9, 6).
        if Decimal(str(value)).as_tuple().exponent < -6:  # type: ignore[operator]
            raise ValueError("at most 6 decimal places")
        return value

    @field_validator("source_url")
    @classmethod
    def _https_url(cls, value: str) -> str:
        parsed = urlparse(value)
        if parsed.scheme != "https" or not parsed.netloc:
            raise ValueError("source_url must be an https URL")
        return value

    @field_validator("source_note")
    @classmethod
    def _states_precision_and_independence(cls, value: str) -> str:
        # The precision limitation is stored with the data, not only in docs.
        if "approximate" not in value.lower():
            raise ValueError("source_note must state that the marker is approximate")
        if NOT_AFFILIATED not in value:
            raise ValueError("source_note must state non-affiliation with Cummins")
        return value


def _note(source: str, purpose_source: str) -> str:
    return (
        f"Business purpose per {purpose_source}. Marker position is approximate: "
        f"the city location per {source}, not the facility's coordinates. "
        f"{NOT_AFFILIATED}"
    )


# Business purposes come from Cummins' own pages; city coordinates come from the
# Wikipedia entry for each city (degrees converted to decimal, 5 places).
FACILITIES: tuple[FacilitySeed, ...] = (
    FacilitySeed(
        id="fridley",
        name="Power Integration Center",
        city="Fridley",
        region="MN",
        country="US",
        latitude=45.08417,
        longitude=-93.25667,
        facility_type="integration_testing",
        is_interactive=True,
        description=(
            "Cummins describes the Power Integration Center as a microgrid lab "
            "at its Power Systems campus in Fridley, Minnesota, used to "
            "configure, test and validate microgrid power systems. GridProof's "
            "Virtual Lab is a fictional, PIC-inspired synthetic environment, "
            "not the real facility."
        ),
        source_url="https://www.cummins.com/generators/power-integration-center",
        source_note=_note(
            "Wikipedia (Fridley, Minnesota)",
            "Cummins (Power Integration Center page)",
        ),
        catalog_version=1,
    ),
    FacilitySeed(
        id="seymour",
        name="Seymour Technical Center and Engine Plant",
        city="Seymour",
        region="IN",
        country="US",
        latitude=38.95722,
        longitude=-85.89444,
        facility_type="engine_plant_and_technical_center",
        is_interactive=False,
        description=(
            "Cummins describes the Seymour Technical Center as a global "
            "engineering center for its High-Horsepower Engine Business in "
            "Seymour, Indiana, co-located with the Seymour Engine Plant. "
            "Informational context only; GridProof does not simulate this site."
        ),
        source_url=(
            "https://investor.cummins.com/news/detail/310/"
            "cummins-celebrates-opening-of-new-seymour-technical-center"
        ),
        source_note=_note(
            "Wikipedia (Seymour, Indiana)",
            "Cummins (Seymour Technical Center press release)",
        ),
        catalog_version=1,
    ),
    FacilitySeed(
        id="daventry",
        name="Daventry Power Systems Plant",
        city="Daventry",
        region="Northamptonshire",
        country="GB",
        latitude=52.25778,
        longitude=-1.16278,
        facility_type="manufacturing_site",
        is_interactive=False,
        description=(
            "Cummins describes its Daventry site in England as its UK power "
            "systems plant, where generator sets are assembled. Informational "
            "context only; GridProof does not simulate this site."
        ),
        source_url="https://www.cummins.com/en-na/eu/daventry-uk",
        source_note=_note(
            "Wikipedia (Daventry)",
            "Cummins (Daventry, U.K. page)",
        ),
        catalog_version=1,
    ),
)

_COLUMNS = tuple(FacilitySeed.model_fields)


def validate_catalog(rows: Sequence[FacilitySeed]) -> None:
    """Catalog-level rules; row-level rules are enforced by FacilitySeed."""
    ids = [row.id for row in rows]
    if len(set(ids)) != len(ids):
        raise CatalogSeedError("Facility ids must be unique.")
    if set(ids) != EXPECTED_IDS:
        raise CatalogSeedError(
            f"The catalog must contain exactly {sorted(EXPECTED_IDS)}, got {sorted(ids)}."
        )
    interactive = sorted(row.id for row in rows if row.is_interactive)
    if interactive != [INTERACTIVE_ID]:
        raise CatalogSeedError(
            f"Only {INTERACTIVE_ID!r} may be interactive, got {interactive}."
        )


def _verify_expected_ids(session: Session) -> None:
    ids = set(session.scalars(select(FacilityCatalog.id)))
    if ids != EXPECTED_IDS:
        raise CatalogSeedError(
            f"facility_catalog holds {sorted(ids)} after seeding; "
            f"expected {sorted(EXPECTED_IDS)}."
        )


def seed_facilities(
    session: Session, rows: Sequence[FacilitySeed] = FACILITIES
) -> dict[str, int]:
    """Upsert the catalog. The caller owns the transaction (commit or rollback).

    Raises CatalogSeedError, before writing anything, if the table already holds
    a facility that is not part of the seed (rows are never deleted: configurations
    reference them with ON DELETE RESTRICT).
    """
    validate_catalog(rows)

    existing = {
        row.id: {col: getattr(row, col) for col in _COLUMNS}
        for row in session.scalars(select(FacilityCatalog))
    }
    unexpected = sorted(set(existing) - EXPECTED_IDS)
    if unexpected:
        raise CatalogSeedError(
            f"facility_catalog contains unexpected rows {unexpected}; refusing to seed."
        )

    values = [row.model_dump() for row in rows]
    summary = {"inserted": 0, "updated": 0, "unchanged": 0}
    for value in values:
        previous = existing.get(value["id"])
        if previous is None:
            summary["inserted"] += 1
        elif previous == value:
            summary["unchanged"] += 1
        else:
            summary["updated"] += 1

    statement = insert(FacilityCatalog).values(values)
    statement = statement.on_conflict_do_update(
        index_elements=[FacilityCatalog.id],
        set_={col: statement.excluded[col] for col in _COLUMNS if col != "id"},
    )
    session.execute(statement)
    _verify_expected_ids(session)
    return summary


def _default_engine() -> Engine:
    from app.db.session import engine  # imported lazily: requires DATABASE_URL

    return engine


def main(
    argv: Sequence[str] | None = None,
    engine: Engine | None = None,
    out: Callable[..., Any] = print,
) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m app.seed.facilities",
        description="Seed the public facility catalog (dry run unless --apply).",
    )
    parser.add_argument("--apply", action="store_true", help="write to the database")
    parser.add_argument(
        "--confirm-host",
        metavar="HOST",
        help="required with --apply for a non-loopback database: its exact host name",
    )
    args = parser.parse_args(argv)

    try:
        validate_catalog(FACILITIES)
    except CatalogSeedError as exc:
        out(f"Seed data invalid: {exc}")
        return 2

    try:
        target = engine if engine is not None else _default_engine()
    except (
        ValueError,
        ImportError,
        SQLAlchemyError,
    ) as exc:  # missing/invalid settings
        out(f"Cannot determine the target database ({type(exc).__name__}).")
        return 2

    host = target.url.host or ""
    database = target.url.database or ""
    remote = host not in LOOPBACK_HOSTS
    where = f"host={host} database={database} ({'remote' if remote else 'local'})"

    if not args.apply:
        out(f"Dry run: no connection made, nothing written. Target: {where}")
        for row in FACILITIES:
            kind = "interactive" if row.is_interactive else "informational"
            out(
                f"  would upsert {row.id}: {row.name} ({row.city}, {row.country}) [{kind}]"
            )
        out("Re-run with --apply to write these rows.")
        return 0

    if remote and args.confirm_host != host:
        out(
            f"Refusing to apply to a remote database ({where}). "
            "Re-run with --confirm-host set to the exact target host name."
        )
        return 2

    out(f"Applying seed. Target: {where}")
    try:
        with Session(target) as session, session.begin():
            summary = seed_facilities(session)
    except CatalogSeedError as exc:
        out(f"Seed failed, transaction rolled back: {exc}")
        return 1
    except SQLAlchemyError as exc:
        out(
            f"Database error ({type(exc).__name__}); transaction rolled back. "
            "Details withheld to avoid exposing connection information."
        )
        return 1

    out(
        "Seed complete: "
        + ", ".join(f"{count} {name}" for name, count in summary.items())
        + "."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
