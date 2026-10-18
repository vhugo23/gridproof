# GridProof — Project Status

**Updated:** 2026-10-17 · **Branch:** `main` · **Last commit when written:** `8cf9a6b`

## Current position

- **M0 Foundation: Done** (F-01 to F-09). Next.js 16 frontend, FastAPI backend, Neon connection, Alembic migrations 001 and 002, test tooling and CI.
- **M1 First vertical slice: not started.**
- **Sprint 1 (agreed):** F-11 isolated PostgreSQL integration testing, then A-01 facility catalog seeding. The documentation foundation is committed (`99dd538`). **F-11 is Done** (commit `2041663`, CI green on both jobs). **A-01 is Done** (commit `09a49d6`, CI green on both jobs, 156 backend tests); the seed has **not** been applied to Neon. **A-01b is Done** (`GET /api/v1/facilities`, commit `7320f28`, CI green on both jobs, 179 backend tests). **A-02 is Done** (`SystemConfigV1`, commit `74fe5e2`, CI green on both jobs, 435 backend tests). **A-03 is Done** (atomic workspace initialization service, commit `8cf9a6b`, CI green on both jobs, 462 backend tests). **A-04 is Done** (`GET /api/v1/session`, commit `b363dad`, CI green on both jobs, 519 backend tests). **A-05 is Done** (`GET /api/v1/configurations/current`, commit `d9427bf`, CI green on both jobs, 554 backend tests). **A-06 is Done** (`POST /api/v1/configurations/{id}/versions`, commit `d117df2`, CI green on both jobs, 663 backend tests). Next: A-07.

## Implemented (verified in source)

- Backend: FastAPI app with `GET /api/v1/health`, `GET /api/v1/health/database`, `GET /api/v1/facilities`, `GET /api/v1/session`, (A-05) `GET /api/v1/configurations/current` and (A-06) `POST /api/v1/configurations/{id}/versions`; settings; DB session; four domain tables defined in the models and in migrations 001/002 (`demo_workspaces`, `facility_catalog`, `configurations`, `configuration_versions`).
- Frontend: one status page that calls the health endpoint through a rewrite.
- Tests: 2 original backend (mocked DB), 2 frontend, plus F-11: 29 guard tests and 70 PostgreSQL integration tests (migrations, constraints, transactions), plus A-01: 40 seed-data tests and 15 seed integration tests (156 backend tests passing locally with the Docker database), plus A-01b: 13 mocked-session and 10 PostgreSQL endpoint tests (179 passing locally). Results in [`07-testing-strategy.md`](07-testing-strategy.md#observed-results).

## Not implemented

applying the seed to Neon, version-saving API and configuration UI, scenarios, simulator, runs, reports, map, 3D, Gemini. See [`09-known-limitations.md`](09-known-limitations.md).

## Roadmap order (Phase A)

F-11 → A-01 → A-01b → A-02 → A-03 (atomic workspace initialization) → A-04 (`GET /session`) → A-05 → A-06 → A-07 → A-08. A-02 has no database dependency. Full detail in [`10-implementation-roadmap.md`](10-implementation-roadmap.md).

## Outstanding issues

1. `/health` does not match the approved contract (task C-11).
2. Neon PostgreSQL major version unconfirmed (test image is `postgres:17`).
3. `ck_configurations_name` still accepts tab/newline-only names at the database level; `ConfigurationName` (A-02) rejects them and A-03/A-06 must use it.
4. Open decisions listed in [`08-decisions.md`](08-decisions.md#open-items-not-yet-decided).

## Risks

- Test PostgreSQL major version may differ from Neon's.
- Cookie forwarding through the Vercel rewrite to Render is unproven.
- `/session` returns 503 on Neon until the facility seed is applied (separate approval).
- Writes are rejected from every browser origin until `FRONTEND_ORIGINS` is configured on the backend host (not done; deployment action).
- The simulator, the core credibility feature, is untouched.

## Next three recommended actions

1. Start A-07 (minimal frontend configuration editor) in a new conversation using the handoff; set `FRONTEND_ORIGINS` for local development.
2. Confirm Neon's PostgreSQL major version and align the test image if needed; separately decide when to apply the facility seed to Neon.
3. Set `FRONTEND_ORIGINS` on the backend host before any deployed frontend can save (deployment action, needs approval).

## Documents

[`01`](01-product-requirements.md) · [`02`](02-user-flows-and-acceptance-criteria.md) · [`03`](03-system-architecture.md) · [`04`](04-database-design.md) · [`05`](05-api-contracts.md) · [`06`](06-development-log.md) · [`07`](07-testing-strategy.md) · [`08`](08-decisions.md) · [`09`](09-known-limitations.md) · [`10`](10-implementation-roadmap.md)
