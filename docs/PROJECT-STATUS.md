# GridProof — Project Status

**Updated:** 2026-10-17 · **Branch:** `main` · **Last commit when written:** `4231476`

## Current position

- **M0 Foundation: Done** (F-01 to F-09). Next.js 16 frontend, FastAPI backend, Neon connection, Alembic migrations 001 and 002, test tooling and CI.
- **M1 First vertical slice: not started.**
- **Sprint 1 (agreed):** F-11 isolated PostgreSQL integration testing, then A-01 facility catalog seeding. The documentation foundation was completed first, and its changes are not committed.

## Implemented (verified in source)

- Backend: FastAPI app with `GET /api/v1/health` and `GET /api/v1/health/database`; settings; DB session; four domain tables defined in the models and in migrations 001/002 (`demo_workspaces`, `facility_catalog`, `configurations`, `configuration_versions`).
- Frontend: one status page that calls the health endpoint through a rewrite.
- Tests: 2 backend (mocked DB), 2 frontend. Results in [`07-testing-strategy.md`](07-testing-strategy.md#observed-results).

## Not implemented

Facility seed, `SystemConfigV1`, workspace sessions, configuration APIs and UI, scenarios, simulator, runs, reports, map, 3D, Gemini. See [`09-known-limitations.md`](09-known-limitations.md).

## Roadmap order (Phase A)

F-11 → A-01 → A-02 → A-03 (atomic workspace initialization) → A-04 (`GET /session`) → A-05 → A-06 → A-07 → A-08. A-02 has no database dependency. Full detail in [`10-implementation-roadmap.md`](10-implementation-roadmap.md).

## Outstanding issues

1. `/health` does not match the approved contract (task C-11).
2. No real-database tests (F-11).
3. Open decisions listed in [`08-decisions.md`](08-decisions.md#open-items-not-yet-decided).

## Risks

- Database behavior cannot be proven until F-11 exists.
- Cookie forwarding through the Vercel rewrite to Render is unproven.
- The simulator, the core credibility feature, is untouched.

## Next three recommended actions

1. Review and commit the documentation foundation (owner decision; nothing is committed yet).
2. Choose the isolated PostgreSQL source for F-11 and implement the harness.
3. Implement A-01 with verified facility coordinates and source URLs.

## Documents

[`01`](01-product-requirements.md) · [`02`](02-user-flows-and-acceptance-criteria.md) · [`03`](03-system-architecture.md) · [`04`](04-database-design.md) · [`05`](05-api-contracts.md) · [`06`](06-development-log.md) · [`07`](07-testing-strategy.md) · [`08`](08-decisions.md) · [`09`](09-known-limitations.md) · [`10`](10-implementation-roadmap.md)
