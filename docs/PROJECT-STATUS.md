# GridProof — Project Status

**Updated:** 2026-10-26 · **Branch:** `main` (H-12b Mobile-Site Power Planner is implemented locally on `feature/mobile-power-planner`, uncommitted; see the last section) · **Latest source commit:** `9fdcf23` (Mining duty-cycle workbench release; Backend Checks and Frontend Checks green; Vercel production deployment completed). Backend API-18 (`e71a057`) is live on Render. See the Mining section below for the production verification. Guided challenges (`c52b553`), unchanged from the previous status: the deployed Vercel commit has **not** been verified through Vercel. A read-only fetch of the public site at about 17:20 UTC on 2026-10-19, shortly after the push, served a JavaScript chunk containing the new challenge text, which suggests the push triggered an automatic production deploy; it was not confirmed in the Vercel dashboard and no production smoke test has been run on this build.

## Current position

- **M0 Foundation: Done** (F-01 to F-09). Next.js 16 frontend, FastAPI backend, Neon connection, Alembic migrations 001 and 002, test tooling and CI.
- **M1 First vertical slice: Done for the conference scope** (A-01 to A-07 plus the demo slices below). Conference execution plan: map, lab, configuration editor, deterministic startup check, comparison UI. **Publicly deployed** at https://gridproof-seven.vercel.app/ (see [Deployment observations](#deployment-observations-2026-10-19)).
- **Sprint 1 (agreed):** F-11 isolated PostgreSQL integration testing, then A-01 facility catalog seeding. The documentation foundation is committed (`99dd538`). **F-11 is Done** (commit `2041663`, CI green on both jobs). **A-01 is Done** (commit `09a49d6`, CI green on both jobs, 156 backend tests); the seed had not been applied to Neon at that point (superseded: see Deployment observations). **A-01b is Done** (`GET /api/v1/facilities`, commit `7320f28`, CI green on both jobs, 179 backend tests). **A-02 is Done** (`SystemConfigV1`, commit `74fe5e2`, CI green on both jobs, 435 backend tests). **A-03 is Done** (atomic workspace initialization service, commit `8cf9a6b`, CI green on both jobs, 462 backend tests). **A-04 is Done** (`GET /api/v1/session`, commit `b363dad`, CI green on both jobs, 519 backend tests). **A-05 is Done** (`GET /api/v1/configurations/current`, commit `d9427bf`, CI green on both jobs, 554 backend tests). **A-06 is Done** (`POST /api/v1/configurations/{id}/versions`, commit `d117df2`, CI green on both jobs, 663 backend tests). **A-07 is Done** (commit `b79d012`, CI run 39139803047 green on both jobs: 663 backend tests, 21 frontend tests). Next: the startup-delay simulator and `POST /api/v1/demo/startup-check` (approved scope).

## Implemented (verified in source)

- Backend: FastAPI app with `GET /api/v1/health`, `GET /api/v1/health/database`, `GET /api/v1/facilities`, `GET /api/v1/session`, (A-05) `GET /api/v1/configurations/current` and (A-06) `POST /api/v1/configurations/{id}/versions`; settings; DB session; four domain tables defined in the models and in migrations 001/002 (`demo_workspaces`, `facility_catalog`, `configurations`, `configuration_versions`).
- Frontend (A-07 + conference slice, commit `b79d012`): SVG facility map (Fridley/Seymour/Daventry) → Fridley 2.5D synthetic lab → equipment inspector (G1/G2 delay and enable, battery initial SoC, critical load) → save as new version → server-confirmed reload. API client, session bootstrap and error states (validation, 409 conflict, session expiry, outage). The old health-status page and `ConnectionBadge` were replaced by a header API-status chip. `next.config.ts` reads `API_PROXY_TARGET` (default `http://127.0.0.1:8000`).
- Tests: 2 original backend (mocked DB), 2 frontend, plus F-11: 29 guard tests and 70 PostgreSQL integration tests (migrations, constraints, transactions), plus A-01: 40 seed-data tests and 15 seed integration tests (156 backend tests passing locally with the Docker database), plus A-01b: 13 mocked-session and 10 PostgreSQL endpoint tests (179 passing locally). Results in [`07-testing-strategy.md`](07-testing-strategy.md#observed-results).

## Not implemented

general scenarios, persisted runs, PDF reports, 3D, Gemini. (Only the fixed startup-check scenario exists; it is stateless.) See [`09-known-limitations.md`](09-known-limitations.md).

## Roadmap order (Phase A)

F-11 → A-01 → A-01b → A-02 → A-03 (atomic workspace initialization) → A-04 (`GET /session`) → A-05 → A-06 → A-07 → A-08. A-02 has no database dependency. Full detail in [`10-implementation-roadmap.md`](10-implementation-roadmap.md).

## Outstanding issues

1. `/health` does not match the approved contract (task C-11).
2. Neon PostgreSQL was reported as 18.6 in an earlier read-only inspection (owner-reported; not independently verified here). The local test image is `postgres:17`, so tests do not run on the production major version.
3. `ck_configurations_name` still accepts tab/newline-only names at the database level; `ConfigurationName` (A-02) rejects them and A-03/A-06 must use it.
4. Open decisions listed in [`08-decisions.md`](08-decisions.md#open-items-not-yet-decided).

## Risks

- Test PostgreSQL major version (17) differs from the reported Neon version (18.6).
- Cookie forwarding through the Vercel rewrite to Render was observed working end to end (session and a save), but is not covered by an automated test; Safari, Firefox and real touch devices are unverified.
- `FRONTEND_ORIGINS`: saves from the deployed frontend were observed succeeding, so the backend accepts that origin. The expected value is `https://gridproof-seven.vercel.app`; the exact value set on Render is not independently verified.
- Which commit is deployed, and whether a deploy is pending for later commits, is not verified.
- The simulator is a single fixed, simplified, stateless scenario (`docs/09-known-limitations.md`, startup-check notes); it is not validated against real equipment.

## Next three recommended actions

1. Run the production smoke test on the public URL (it creates demo-workspace versions; needs approval) and rehearse the recorded-demo fallback. Confirm in Vercel whether pushes to `main` auto-deploy.
2. Verify the deployed Vercel commit and the Render `FRONTEND_ORIGINS` value, and record them here.
3. Record the SHPE demo (G-06) from the deployed app. Post-conference: Daventry screening workbench (amendment approved, not built), Seymour engine test-plan exercise and vehicle application ideas (roadmap concepts only).

## Documents

[`01`](01-product-requirements.md) · [`02`](02-user-flows-and-acceptance-criteria.md) · [`03`](03-system-architecture.md) · [`04`](04-database-design.md) · [`05`](05-api-contracts.md) · [`06`](06-development-log.md) · [`07`](07-testing-strategy.md) · [`08`](08-decisions.md) · [`09`](09-known-limitations.md) · [`10`](10-implementation-roadmap.md)

## Conference-demo slices (added 2026-10-18)

- **A-07** frontend configuration editor, map and lab: commit `b79d012`, CI run 39139803047 green.
- **Startup check** (`POST /api/v1/demo/startup-check`, doc 05 API-16, decision D-23): commit `cd09696`, CI run 39141348897 green (1321 backend, 21 frontend tests).
- **Comparison UI** (baseline v1 versus latest saved version, timeline, assumptions, playback driven by evidence frames, labeled recorded-demo fallback): **Done**: commit `e9bedf0`, CI run 39142514734 green on both jobs (1323 backend, 36 frontend tests).
- **Frontend presentation polish and Industry Applications** (gallery of five application briefs in one native dialog, lab links for G1 and battery, compact tabbed lab layout, inspector illustrations): frontend only; no backend, API, migration or dependency change. Application briefs are informational context, not simulations (amended 2026-10-20, D-28: the Mining brief also opens a synthetic duty-cycle analyzer; the other briefs are unchanged).

## Deployment observations (2026-10-19)

Reported by the project owner; not re-verified by the assistant in this session.

- The frontend is publicly accessible at https://gridproof-seven.vercel.app/.
- Through the deployed frontend, the owner observed: saving G1 configuration version 2, the live startup simulation and the evidence comparison all working.
- These observations imply the session cookie, the origin allowlist, migrations 001/002 and the facility seed work in production. The apply steps themselves are not recorded in these docs.
- Not verified: the deployed commit SHA, the exact Render `FRONTEND_ORIGINS` value, Neon's version beyond the earlier owner-reported 18.6.

## Guided challenges (H-01, H-02; 2026-10-19; not deployed)

Status: **Done** (H-01, H-02, H-03). Commit `c52b553`; GitHub Actions run 39293011501 green on both jobs (99 frontend tests in 10 files, 1324 backend tests). Verified locally before the push on Docker `postgres:17`. Frontend only, plus one backend regression test. No API, schema, seed or dependency change. Launched only from the Power generation and Battery storage briefs; a normal map-to-lab entry is unchanged. Details in [`06-development-log.md`](06-development-log.md) and [`07-testing-strategy.md`](07-testing-strategy.md); decisions D-24 to D-26 in [`08-decisions.md`](08-decisions.md).

## Daventry synthetic workbench (H-10; 2026-10-19)

Status: **CI green** (GitHub Actions run 39340185054, commit `c0735662fcf8c638e12e41d0bb6a7bf80146b13e`: Frontend Checks and Backend Checks succeeded; 118 frontend tests (11 files), 1416 backend tests) after local verification (backend 1416 tests; frontend 11 files, 118 tests; browser walkthrough and layout audit; details in [`07-testing-strategy.md`](07-testing-strategy.md#daventry-workbench-local-2026-10-19)). Public deployment, read-only check on 2026-10-19 (no workspace created, no Neon access): the Vercel frontend serves the new build (the Daventry marker, card and workbench load, `GET /api/v1/facilities` returns 200 with no cookie, the landing page and the Fridley/Seymour markers and the five Industry Applications cards load). The Render backend had **not** redeployed: `POST /api/v1/demo/capacity-check` through the public proxy returned `404 Not Found` from uvicorn at every check from about 2 to 13 minutes after the push (push at about 23:13Z, last check 23:26Z), so the public workbench shows "The capacity check could not run: Request failed (404)" with a Retry button, and no result. Whether Render auto-deploys, is still building or failed is not verified (Render was not inspected); a manual Render deploy is a production action awaiting your approval. The Fridley lab route was not loaded because doing so creates a workspace; its landing entry loads and the Fridley code and API are unchanged. Adds `POST /api/v1/demo/capacity-check` (doc 05 API-17, D-27) and the Daventry workbench. No migration, seed, model, dependency or CI change; Neon untouched. Deployment note: the Vercel frontend deploys on pushes to `main` (observed twice); the Render backend did not (see above).
- **Update, 2026-10-20 (read-only check):** the public `POST /api/v1/demo/capacity-check` served results, so the Render backend now serves API-17 (how and when it redeployed is not recorded). The presentation commit `e684c6f` (screening summary, shared-scale bars, collapsed explanations, selectable packages; frontend only) passed CI on both jobs (121 frontend tests, 1416 backend tests) and Vercel reported "Deployment has completed" for it; the public workbench showed the new summary, 8 bars and 4 Inspect buttons at 390 px with no horizontal overflow.

## Mining duty-cycle analyzer (H-12a; 2026-10-20; released and verified in production 2026-10-26)

Status: **released and verified in production (2026-10-26).** Released backend-first: API-18 (`e71a057`) was deployed on Render and verified live, then the frontend and docs shipped as `9fdcf23` (draft PR #2 from `release/mining-frontend-v2`, fast-forwarded to `main`; tree identical to `a4ef122`). Both CI jobs passed on that commit and Vercel deployed it. Draft PR #1 (`feature/mining-duty-cycle`) was closed unmerged because `main` already holds its exact contents; the branch is kept. Adds `POST /api/v1/demo/duty-cycle` (doc 05 API-18, D-28) and a Mining duty-cycle workbench opened from the Mining and off-highway Industry Applications brief at `#mining-duty-cycle`. Verified locally: backend 1500 tests with the Docker `postgres:17` (84 new), frontend 12 files and 143 tests (22 new), lint, format, typecheck and production build clean, and desktop (1366 px) and mobile (390 px) browser runs against a local FastAPI with a throwaway database, plus Daventry and Fridley regressions; details in [`07-testing-strategy.md`](07-testing-strategy.md#mining-duty-cycle-analyzer-local-2026-10-20). No migration, model, seed, dependency or CI change; Neon untouched. The on-highway brief stays informational; Mobile Power and Seymour exercises are not started. **Release lesson (applied):** the Vercel frontend deploys on a push to `main`, but Render did not deploy API-17 promptly, so the backend was deployed and verified first and the frontend pushed second. Limitations: [`09-known-limitations.md`](09-known-limitations.md#mining-duty-cycle-analyzer-notes-2026-10-20).

## Mobile-Site Power Planner (H-12b; 2026-10-26; implemented locally, awaiting review)

Status: **implemented and verified locally; not committed, pushed, deployed or released.** Branch `feature/mobile-power-planner` (from `main` at `44f8aa5`). Adds `POST /api/v1/demo/mobile-power` (doc 05 API-19, D-29) and a Mobile-Site Power Planner opened from the On-highway trucks and mobile power brief at `#mobile-power-planner`. The use case is a temporary mobile-powered site supplied by an illustrative trailer-mounted source; it models the site's electrical demand (connected load, simultaneous demand, required capacity with margin, contribution by load) and compares it with four invented 30/60/100/150 kW packages, with an all-simultaneous sensitivity and three neutral categories. Steady-state kW only; simultaneity factors are stated to be user-entered planning assumptions. Verified locally: backend 1622 tests with Docker `postgres:17` (122 new), frontend 13 files and 182 tests (39 new), lint, format, typecheck and production build clean, and desktop (1366 px) and mobile (390 px) Chrome runs against a local FastAPI with a throwaway database, plus Daventry, Mining and Fridley regressions; details in [`07-testing-strategy.md`](07-testing-strategy.md#mobile-site-power-planner-local-2026-10-26). No migration, model, seed, dependency or CI change; Neon untouched. Mining, Daventry and the lab are unchanged. Seymour is not started. Release must follow the D-28 order: Render backend live and verified first, then the frontend. Limitations: [`09-known-limitations.md`](09-known-limitations.md#mobile-site-power-planner-notes-2026-10-26).
