# GridProof — Development Log

**Document:** `docs/06-development-log.md`  
**Version:** 1.0 · 2026-10-17  
**Purpose:** Concise, chronological record of what was actually done. Entries are supported by Git history. Not a plan; see [`10-implementation-roadmap.md`](10-implementation-roadmap.md) for planned work.

All 14 commits below are dated 2026-10-17 in Git (`git log`, oldest first).

## 2026-10-17 — Foundation (M0)

| Commit | Summary | Roadmap |
|---|---|---|
| `b95bcad` | Initialized project structure and documentation (docs 01–05) | F-01, F-02 |
| `8249b91` | Flattened the project directory structure | F-02 |
| `1c12098` | Integrated the frontend with the FastAPI health endpoint (`/api/v1/health` through a Next.js rewrite) | F-03, F-04 |
| `4c8ddc6` | Initialized Alembic; created `demo_workspaces` and `facility_catalog` (migration 001) | F-05, F-06 |
| `4f86933` | Consolidated backend database modules; fixed lint issues | F-05 |
| `130ad0c` | Fixed backend import ordering | — |
| `30a1394` | Added versioned configuration tables, `configurations` and `configuration_versions` (migration 002) | F-06 |
| `abdbd30` | Established automated testing, formatting and CI | F-07, F-08 |
| `ec82ed3` | Activated CI quality checks; updated setup documentation | F-08, F-09 |
| `51063d4` | CI fix for Linux dependency resolution (CI installs with `npm install` instead of `npm ci`) | F-08, F-10 |
| `ebe1338` | Formatted PostCSS configuration | — |
| `9c19cc4` | Removed the generated `LayoutProps` dependency from the frontend | F-03 |
| `a3ae823` | Updated README with setup and architecture | F-09 |
| `4231476` | Added the ordered implementation roadmap (doc 10) | — |

## 2026-10-17 — Repository assessment and documentation foundation

Documentation only; no application code, migrations or CI changes.

- Read-only assessment of docs against source. Findings are recorded in [`09-known-limitations.md`](09-known-limitations.md) and [`08-decisions.md`](08-decisions.md).
- Created docs 06–09 and `PROJECT-STATUS.md`.
- Reconciled doc 01/02/03 inconsistencies (repository layout, tooling, retention wording, requirement identifiers, `run_idempotency` table, facility count, PDF priority).
- Restructured roadmap Phase A: session initialization is split into `SystemConfigV1` (A-02), an atomic initialization service (A-03) and `GET /session` (A-04). F-11 is now a prerequisite for database-backed work. Added C-11 for the health-contract update.
- Document versions: 01 → 1.2, 02 → 1.2, 03 → 1.1, 10 → 1.1. Docs 04 and 05 are unchanged.
- Checks run on this date are listed in [`07-testing-strategy.md`](07-testing-strategy.md#observed-results).
- Committed as `99dd538` on `main`.

## 2026-10-17 — F-11 isolated PostgreSQL integration testing (`2041663`)

- Added `backend/docker-compose.test.yml`, `backend/pytest.ini`, and `backend/tests/integration/` (guard, fixtures, migration, constraint and transaction tests).
- `backend/migrations/env.py` accepts an injected connection (`config.attributes["connection"]`); behavior without one is unchanged (verified with offline `alembic upgrade head --sql`).
- CI backend job gained a PostgreSQL 17 service container and now also lints `migrations/env.py`. GitHub Actions run 39096658114: both jobs green, 101 backend tests passed.
- Finding: `ck_configurations_name` does not reject tab/newline-only names (see `09-known-limitations.md`).
- Decision D-15 recorded. Observed results are in `07-testing-strategy.md`.

## 2026-10-17 — A-01 facility catalog seed (`09a49d6`)

- Added `backend/app/seed/facilities.py` (validated rows, idempotent upsert, CLI with dry run, `--apply`, and `--confirm-host` for remote databases) plus unit and PostgreSQL integration tests.
- No schema change, migration, dependency, CI change or Neon access. Decision D-16 recorded; roadmap task A-01b (`GET /api/v1/facilities`) added.
- Source limits are documented in `09-known-limitations.md`.
- GitHub Actions run 39097553393: both jobs green, 156 backend tests passed. The seed was not run against Neon.

## 2026-10-17 — A-01b public facilities endpoint (`7320f28`)

- Added `GET /api/v1/facilities` (`app/routes/facilities.py`, `app/core/errors.py`), router registration in `app/main.py`, and unit and PostgreSQL integration tests. `docs/05-api-contracts.md` is now 1.1 (`description` added; cache and error headers specified).
- No schema change, migration, dependency, CI change or Neon access. Decision D-17 recorded. Error handling is scoped to the route (no application-wide handler).
- GitHub Actions run 39098605127: both jobs green, 179 backend tests passed. The seed was not run against Neon and nothing was deployed.

## 2026-10-18 — A-02 SystemConfigV1 schema (`74fe5e2`)

- Added `app/domain/system_config.py` (frozen strict models, default Fridley config, snapshot helpers, safe validation details, `ConfigurationName`) and schema, name and PostgreSQL storage tests. `docs/05-api-contracts.md` is now 1.2 (fixed fields, integers, load-demand distinction, name rules).
- No endpoint, schema, migration, dependency, CI or frontend change; no Neon access. Decision D-18 recorded.
- Review added `load_snapshot(schema_version, data)`: stored snapshots with any version other than `config-v1` raise `UnsupportedSchemaVersion`. GitHub Actions run 39130740308: both jobs green, 435 backend tests passed. Nothing was seeded on Neon or deployed.

## 2026-10-18 — A-03 atomic workspace initialization (`8cf9a6b`)

- Added `app/services/workspaces.py` (`initialize_workspace`, token generation and SHA-256 hashing) with token unit tests and PostgreSQL tests for success, expiry, token storage, transaction ownership and rollback at each stage. Decisions D-19 recorded.
- The caller owns the outer transaction; the service requires one, uses a savepoint, never commits. Failures were injected with temporary database triggers; four deliberate breakages of the service (no savepoint, plaintext token, service commit, wrong pointer) were each caught by the tests.
- GitHub Actions run 39131471726: both jobs green, 462 backend tests passed. Nothing was seeded on Neon or deployed. A-02 documentation closure is commit `bd6b3d8`.

## 2026-10-18 — A-04 `GET /api/v1/session` (`b363dad`)

- Added `app/services/sessions.py` (cookie parsing, reuse, advisory-lock-serialized issuance with a global rolling cap) and `app/routes/session.py`, registered in `app/main.py`. `docs/05-api-contracts.md` is v1.3 (fixed-expiry wording, cookie attributes, headers, errors, `Retry-After`). Decision D-20. No migration, schema, dependency, CI or frontend change; no Neon access.
- Added cookie-parser unit tests and PostgreSQL endpoint tests (rollback and commit failures via triggers, expiry, reuse, malformed and duplicate cookies, concurrency, cap, lock timeout, proxy headers, log secrecy). Eight deliberate breakages were each caught. GitHub Actions run 39133125159: both jobs green, 519 backend and 2 frontend tests passed. Nothing was seeded on Neon or deployed.

## 2026-10-18 — A-05 `GET /api/v1/configurations/current` (`d9427bf`)

- Added `app/services/workspace_auth.py` (cookie to active workspace, read-only, reusing the A-04 parser and A-03 hash), `app/services/configurations.py` (workspace-scoped read of the version named by the pointer, validated with `load_snapshot`) and `app/routes/configurations.py`; registered in `app/main.py`. `docs/05-api-contracts.md` is v1.4. Decision D-21. No migration, schema, model, dependency, CI or frontend change; no Neon access.
- 35 PostgreSQL tests added; seven deliberate breakages were each caught. GitHub Actions run 39134011492: both jobs green, 554 backend and 2 frontend tests passed. Nothing was seeded on Neon or deployed.

## 2026-10-18 — A-06 `POST /api/v1/configurations/{id}/versions` (`d117df2`)

- Added `save_version` to `app/services/configurations.py` (workspace-scoped row lock, stored-data validation, optimistic concurrency, best-effort replay, atomic insert, name and pointer update) and the `POST` route in `app/routes/configurations.py` (Origin allowlist, media type, 256 KiB body limit on actual bytes, strict JSON parsing, sanitized errors). Added the optional `frontend_origins` setting (`FRONTEND_ORIGINS`). `docs/05-api-contracts.md` is v1.5. Decision D-22. No migration, model, dependency, CI or frontend change; no Neon access.
- 109 PostgreSQL tests added; twelve deliberate breakages were each caught. A flaky A-05 test (digits matching inside a random request id) was fixed. GitHub Actions run 39136691225: both jobs green, 663 backend and 2 frontend tests passed. Nothing was seeded on Neon or deployed.

## 2026-10-18 — Conference-demo execution (`b79d012`)

Strategy changed to a 10-day SHPE conference demo; scope and order approved by the project owner. Committed as `b79d012` (CI run 39139803047 green):

- A-07 frontend: typed API client (`frontend/src/lib/api.ts`), `useWorkspaceConfig` (lazy session bootstrap, draft/dirty tracking, save with `expected_version`, server confirmation via `GET /configurations/current`, 409/422/401/503 handling that never discards the draft), SVG map generated once from Natural Earth data (public domain), isometric synthetic Fridley lab, inspector with fixed vs editable fields.
- Later the same day: the startup-check simulator and the comparison UI (entries below).

## 2026-10-18 — Deterministic startup check (`cd09696`)

- Added `app/domain/startup_check.py` (pure model, exact integer ms and kW*ms, 300 s horizon, readiness and transfer as separate events), `app/services/startup_check.py` (workspace-scoped read of an immutable version inside a read-only transaction), `POST /api/v1/demo/startup-check` (`app/routes/demo.py`), and moved the Origin check to `app/core/origin.py` (behavior unchanged; one A-06 test fixture retargeted). Documented as doc 05 API-16 and decision D-23.
- Review found one frame inconsistency (battery emptied at the same millisecond as transfer showed battery power with zero energy). Fixed: depletion is ordered before generator events at that timestamp and an empty battery delivers 0 kW in every frame. A grid of 588 combinations now checks every frame.
- Mutation checks: nine of ten deliberate breakages were caught (the tenth was dead logic and was removed). GitHub Actions run 39141348897: both jobs green, 1321 backend and 21 frontend tests.

## 2026-10-18 — Comparison UI and recorded fallback (`e9bedf0`, CI run 39142514734 green: 1323 backend, 36 frontend tests)

- Frontend: typed evidence and API call, `useStartupComparison` (baseline v1 plus latest version in parallel; one card with an explanatory note when only v1 exists), `usePlayback` (frame stepping only), `ComparePanel`, `Timeline`, frame-driven lab scene (`frameView.ts`). Metrics, requirement statuses, states and highlighted connections come only from the returned evidence or the recorded fixture; no energy is recomputed from frames.
- Recorded fallback: `frontend/src/lib/recorded/startup-check-5s-vs-15s.json`, generated from the simulator; `backend/tests/test_recorded_fixture.py` fails if it drifts. It is labeled as recorded and makes no startup-check request.
- Failure handling for 401, 403, 404, 500, 503 and network errors leaves the configuration and unsaved draft untouched.
- Nothing was seeded on Neon or deployed.

## 2026-10-18 — Frontend presentation polish and Industry Applications (frontend only)

- Landing page: map plus facility card (`FacilityCard`, synthetic lab preview thumbnail via `previewConfig.ts`), compact layout, independent-branding header line. Lab page: run and recorded-demo buttons in the header, a tabbed right panel (Inspector or Test results with a wide-view toggle), compact comparison cards, event log and assumptions collapsed, and a re-laid-out timeline. Behavior and data flow are unchanged; the existing tests were adjusted only to open the Test results tab first.
- Industry Applications: seven original SVG illustrations in `frontend/public/illustrations/` (generator set, motors and electrical, battery plus switchgear, battery, switchgear, mining haul truck, on-highway truck; isometric, authored for GridProof, no logos or third-party imagery). Five gallery cards open one native `<dialog>` (`ApplicationDialog`) driven by the static typed array in `gallery/applications.ts` (summary, four qualitative considerations, optional lab action). Power generation opens the Fridley lab with G1 selected, battery and switchgear with the battery selected, motors opens the lab with nothing selected and says motors are not modeled; mining and on-highway are informational only. `AppShell.openLabFrom` selects the asset, switches to the Inspector tab and reuses `enterLab`. The inspector shows a compact, labeled illustration for G1/G2, battery and switchgear.
- Inspector: the unit label width was `w-4`, too narrow for "kW"; now `w-6`. Measured at 1024 to 1920 px: no horizontal overflow in the right panel (Inspector for every asset, and Test results with the recorded demo) and none at page level.
- Verified in headless Chrome against a mock backend: Enter opens a card, focus moves into the dialog, Tab stays inside, the background is inert, body scroll is locked, Escape and backdrop click close it, focus returns to the originating card. `src/test/setup.ts` has a minimal jsdom stand-in for `showModal()` and `close()`; real-browser behavior was checked separately.
- No backend, migration, API, simulation or dependency change. Known limitation: `npm run format:check` reports `package-lock.json` only in a Windows checkout with CRLF line endings; the committed file passes Prettier.

## 2026-10-19 — Guided challenges and status reconciliation (local, uncommitted)

- **Status reconciliation:** the public deployment at https://gridproof-seven.vercel.app/ was reported working by the owner (saved G1 v2, live startup simulation, evidence comparison). Stale statements in PROJECT-STATUS and 09-known-limitations about deployment and seeding are corrected or marked superseded; earlier dated log entries are left as written. Unverified items (deployed SHA, Render `FRONTEND_ORIGINS` value, the Neon 18.6 reported earlier) are labeled as such.
- **Requirements amendment (D-24):** Daventry generator-package screening exercise permitted once implemented; not built; no seed or contract change.
- **Implemented:** the G1 startup and battery continuity challenges: `components/challenges/deriveChallenge.ts` (pure progress derivation), `ChallengePanel.tsx` (compact expandable panel above Inspector/Results), `ChallengeId` wiring through the application briefs and `AppShell`, and a monotonic `seq` on `ComparisonResult`. No backend code, API, schema, seed or dependency change.
- **Problems found while verifying:** (1) after a reveal, saving a newer version did not invite a new prediction; `canPredict` now allows it once the saved version differs from the revealed one. (2) At 390 px the truncating panel header widened the grid track to 741 px (page-level horizontal scroll); the header label now wraps.
- **Review before commit:** the sequence counter no longer advances for recorded results (it carries the current value) and gained hook tests for failed, superseded and cleared runs; flow tests cover a failing run after a prediction and unsaved edits surviving presets and dismissal. A layout audit at 1366x768 and 390 px raised the 10 px eyebrow label to 11 px.
- **CI and deployment observation (after the push):** run 39293011501 green on both jobs. A read-only fetch of the public site shortly afterwards served the new challenge text, so a push to `main` appears to auto-deploy the frontend on Vercel (not confirmed in the Vercel dashboard). The backend had no code change.
- **Process note:** ports 3000 and 8000 were already held by other local processes, so verification used 3010 and 8010 with a throwaway database in the local Docker `postgres:17`, dropped afterwards. A production build was run in `frontend/.next`.

## 2026-10-19 — Daventry synthetic generator workbench (H-10; local verification)

- **Implemented:** `domain/capacity_check.py` (pure, exact arithmetic), `routes/daventry.py` (`POST /api/v1/demo/capacity-check`, API-17, stateless, no session or database), one `include_router` line in `main.py`; frontend `components/daventry/Workbench.tsx`, `lib/useCapacityCheck.ts`, `lib/experiences.ts`, `runCapacityCheck` in `lib/api.ts`, capacity types, a new illustration `public/illustrations/daventry-package-lineup.svg` (original isometric artwork, about 18 KB), and the Daventry card/marker/route changes in `FacilityCard`, `FacilityMap` and `AppShell`. No migration, model, seed, dependency, CI or `demo.py` change; no Neon access.
- **Why exact arithmetic:** a scan of the input space found 33 cases where float division changes a verdict (for example 228 kW at 0.57 pf is exactly 400 kVA but 228/0.57 is 400.00000000000006).
- **Problems found while verifying:** (1) the card's illustration collapsed to zero height inside the flex column (added `shrink-0`); (2) at 1366x768 the card's button fell below the fold, so the workbench box with its button now sits above the "About the real site" text; (3) an out-of-range exponent such as `1e9999999999999999999` raises `decimal.InvalidOperation` while parsing, which is not a `ValueError`; it is now a 422, not a 500.
- **Process note:** verification used a throwaway database in the local Docker `postgres:17` (dropped afterwards), ports 3010 and 8010. Verification was local only; at that point nothing had been committed, pushed or deployed.
- **Whitespace check:** `git diff --check` reports trailing whitespace on the `Version` line of `05-api-contracts.md`. The two trailing spaces are an intentional Markdown hard break, used by every header line in that file; no other whitespace error was reported (only the Windows LF-to-CRLF notices).


## 2026-10-20 — Mining duty-cycle energy analyzer (H-12a; local verification)

- **Implemented:** `domain/duty_cycle.py` (pure model, exact `Fraction` arithmetic, input validation and cross-field rules), `routes/mining.py` (`POST /api/v1/demo/duty-cycle`, API-18, stateless, no session or database), one `include_router` line in `main.py`; frontend `components/mining/DutyCycleWorkbench.tsx` (segment editor, energy and power tiles, server explanation, interactive per-segment breakdown), `lib/useStatelessCheck.ts` (generic), `lib/useDutyCycle.ts`, an API client function, types, a hash route `#mining-duty-cycle`, and a second action on the Mining brief (`workbench` field on `Application`). `Field` moved unchanged into `components/workbench/Field.tsx`. Existing mining illustration reused.
- **Decisions:** D-28 (doc 08); doc 05 API-18; PRD out-of-scope line and UF-02b amended. Mobile Power and Seymour were not started.
- **Problems found while building:** (1) a code review of the domain model found that ordering comparisons on a `Decimal` NaN raise instead of returning, which would have been a 500; finiteness is now checked first and the tests cover NaN and Infinity. (2) The browser run showed that after a failed re-run an earlier result stayed on screen with no "inputs changed" notice, because the snapshot was taken at submit time; it is now stored with the result, and a test covers it. (3) `ruff` rejected unparenthesized implicit string concatenation in test parameter lists; the cases were rebuilt with a small body builder. (4) The existing gallery test asserted the Mining brief was informational only; it now asserts the new analyzer and that the on-highway brief still is.
- **Process note:** verification used a throwaway database in the local Docker `postgres:17` (dropped afterwards), ports 3100 and 8010, because other local processes hold ports 3000 and 8000. Neon was not touched. At that point nothing was committed, pushed or deployed.
- **Daventry stale-result fix (owner-requested before release):** the Daventry workbench compared the form with the inputs of the latest attempt, so a failed re-run made an older result look current. It now pairs each result with the inputs that produced it (`shown` state in `Workbench.tsx`, set when a result arrives); the hooks were not changed. Three regression tests were added to `Workbench.test.tsx`. The Mining results card also gained an explicit line that the numbers are calculated from the illustrative profile the user entered and are not measurements of any haul truck or machine.

## 2026-10-26 — Mining duty-cycle analyzer released (H-12a)

- **Sequence:** backend first. Render served an older commit until API-18 (`e71a057`) was deployed from the dashboard; the live endpoint then returned HTTP 200 for the hand-calculated sample (`duty-cycle-v1`, 77.00 kWh and 25.00 min per cycle, 1,386.00 kWh and 450.00 min per shift, 184.8 kW average, 300 kW peak, `dominant_segment_ids` `["segment-2"]`), and the Daventry capacity-check was unchanged.
- **Frontend:** the planned release branch commit was not available in the working clone, so `release/mining-frontend-v2` was rebuilt from `main` by applying the `a4ef122` files. Its tree (`95e496f`) is identical to `a4ef122`; the 24-file diff touched only `frontend/src` and `docs/`. Draft PR #2 ran CI (Backend Checks and Frontend Checks green), then the commit `9fdcf23` was fast-forwarded to `main` without force. Vercel deployed it.
- **Cleanup:** draft PR #1 was closed without merging (no changes absent from `main`); `feature/mining-duty-cycle` was kept.
