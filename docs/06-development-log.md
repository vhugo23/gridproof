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
