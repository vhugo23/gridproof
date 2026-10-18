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
