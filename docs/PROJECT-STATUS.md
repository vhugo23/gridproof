# GridProof — Project Status

**Updated:** 2026-10-18 · **Branch:** `main` · **Last verified commit:** `cd09696` (simulator; the comparison UI is committed after it)

## Current position

- **M0 Foundation: Done** (F-01 to F-09). Next.js 16 frontend, FastAPI backend, Neon connection, Alembic migrations 001 and 002, test tooling and CI.
- **M1 First vertical slice: Done for the conference scope** (A-01 to A-07 plus the demo slices below). Conference execution plan: map, lab, configuration editor, deterministic startup check, comparison UI. Deployment is not done.
- **Sprint 1 (agreed):** F-11 isolated PostgreSQL integration testing, then A-01 facility catalog seeding. The documentation foundation is committed (`99dd538`). **F-11 is Done** (commit `2041663`, CI green on both jobs). **A-01 is Done** (commit `09a49d6`, CI green on both jobs, 156 backend tests); the seed has **not** been applied to Neon. **A-01b is Done** (`GET /api/v1/facilities`, commit `7320f28`, CI green on both jobs, 179 backend tests). **A-02 is Done** (`SystemConfigV1`, commit `74fe5e2`, CI green on both jobs, 435 backend tests). **A-03 is Done** (atomic workspace initialization service, commit `8cf9a6b`, CI green on both jobs, 462 backend tests). **A-04 is Done** (`GET /api/v1/session`, commit `b363dad`, CI green on both jobs, 519 backend tests). **A-05 is Done** (`GET /api/v1/configurations/current`, commit `d9427bf`, CI green on both jobs, 554 backend tests). **A-06 is Done** (`POST /api/v1/configurations/{id}/versions`, commit `d117df2`, CI green on both jobs, 663 backend tests). **A-07 is Done** (commit `b79d012`, CI run 39139803047 green on both jobs: 663 backend tests, 21 frontend tests). Next: the startup-delay simulator and `POST /api/v1/demo/startup-check` (approved scope).

## Implemented (verified in source)

- Backend: FastAPI app with `GET /api/v1/health`, `GET /api/v1/health/database`, `GET /api/v1/facilities`, `GET /api/v1/session`, (A-05) `GET /api/v1/configurations/current` and (A-06) `POST /api/v1/configurations/{id}/versions`; settings; DB session; four domain tables defined in the models and in migrations 001/002 (`demo_workspaces`, `facility_catalog`, `configurations`, `configuration_versions`).
- Frontend (A-07 + conference slice, commit `b79d012`): SVG facility map (Fridley/Seymour/Daventry) → Fridley 2.5D synthetic lab → equipment inspector (G1/G2 delay and enable, battery initial SoC, critical load) → save as new version → server-confirmed reload. API client, session bootstrap and error states (validation, 409 conflict, session expiry, outage). The old health-status page and `ConnectionBadge` were replaced by a header API-status chip. `next.config.ts` reads `API_PROXY_TARGET` (default `http://127.0.0.1:8000`).
- Tests: 2 original backend (mocked DB), 2 frontend, plus F-11: 29 guard tests and 70 PostgreSQL integration tests (migrations, constraints, transactions), plus A-01: 40 seed-data tests and 15 seed integration tests (156 backend tests passing locally with the Docker database), plus A-01b: 13 mocked-session and 10 PostgreSQL endpoint tests (179 passing locally). Results in [`07-testing-strategy.md`](07-testing-strategy.md#observed-results).

## Not implemented

applying the seed to Neon, deployment, general scenarios, persisted runs, PDF reports, 3D, Gemini. (Only the fixed startup-check scenario exists; it is stateless.) See [`09-known-limitations.md`](09-known-limitations.md).

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
- The simulator is a single fixed, simplified, stateless scenario (`docs/09-known-limitations.md`, startup-check notes); it is not validated against real equipment.

## Next three recommended actions

1. Deployment readiness (needs separate approval for each production action): confirm Neon's PostgreSQL major version, apply migrations and the facility seed to Neon, create Render and Vercel projects.
2. Set `FRONTEND_ORIGINS` on the backend host and `API_PROXY_TARGET` on Vercel; prove the session cookie through the Vercel rewrite.
3. Run a complete browser smoke test at the public URL and rehearse the recorded-demo fallback.

## Documents

[`01`](01-product-requirements.md) · [`02`](02-user-flows-and-acceptance-criteria.md) · [`03`](03-system-architecture.md) · [`04`](04-database-design.md) · [`05`](05-api-contracts.md) · [`06`](06-development-log.md) · [`07`](07-testing-strategy.md) · [`08`](08-decisions.md) · [`09`](09-known-limitations.md) · [`10`](10-implementation-roadmap.md)

## Conference-demo slices (added 2026-10-18)

- **A-07** frontend configuration editor, map and lab: commit `b79d012`, CI run 39139803047 green.
- **Startup check** (`POST /api/v1/demo/startup-check`, doc 05 API-16, decision D-23): commit `cd09696`, CI run 39141348897 green (1321 backend, 21 frontend tests).
- **Comparison UI** (baseline v1 versus latest saved version, timeline, assumptions, playback driven by evidence frames, labeled recorded-demo fallback): committed after `cd09696`; its CI result is recorded in the follow-up status update.
