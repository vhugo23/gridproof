# GridProof — Testing Strategy

**Document:** `docs/07-testing-strategy.md`  
**Version:** 1.0 · 2026-10-17  
**Scope:** What exists, how it is run, and what is not yet covered. Only observed results are recorded.

## Principles

- Passing code is not correctness; every feature must satisfy its acceptance criteria in doc 02.
- Test normal inputs, invalid inputs, boundaries and failures.
- Expected values are determined independently of the code under test.
- Never fabricate results, metrics or verification claims.
- **Integration tests never run against production Neon.** They use an isolated PostgreSQL instance (task F-11).
- CI must remain green.

## Commands

| Area | Commands (run from `backend/` or `frontend/`) |
|---|---|
| Backend | `python -m ruff format --check app tests`, `python -m ruff check app tests`, `python -m pytest -q` |
| Frontend | `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build` |

CI (`.github/workflows/ci.yml`) runs both sets on push and pull requests to `main`. The frontend job installs with `npm install` (restoring `npm ci` is F-10/G-02). The backend job uses a dummy `DATABASE_URL` and no PostgreSQL service.

## Current coverage (verified by reading the tests)

| Test | What it covers | Limits |
|---|---|---|
| `backend/tests/test_health.py` | `GET /api/v1/health` response | Checks the current `{status, service}` shape, not the doc 05 API-01 shape |
| `backend/tests/test_database.py` | `GET /api/v1/health/database` | Overrides `get_db` with a `MagicMock`; no real database, no failure path |
| `frontend/src/components/connection-badge.test.tsx` | Presentational `ConnectionBadge` (2 tests) | The component is not used by any page |

## Gaps

- No tests against a real PostgreSQL database and no migration tests (planned: F-11, then G-01 for CI).
- `ApiStatus` has no test.
- No tests for workspaces, seeding, configuration schema or versioning (A-01 onward).
- No determinism, golden-fixture or invariant tests for the simulator (C-10).
- No end-to-end browser tests (E-06).

## Planned approach

1. **F-11:** isolated PostgreSQL (source to be agreed), apply Alembic migrations 001/002 to an empty database, verify the schema against the models, and refuse to run against a Neon host.
2. **Database-backed features:** transactional tests including injected failures and rollback (A-03), cross-workspace isolation, expiry, conflict handling (A-06).
3. **Simulator:** golden fixtures (5 s pass / 15 s fail), repeat-run determinism, conservation of power, negative and boundary input tests.
4. **Release:** Playwright flagship walkthrough against an isolated test database.

## Observed results

Recorded on 2026-10-17, local Windows machine, during the documentation task. These are the only results this document asserts.

| Check | Result |
|---|---|
| `ruff format --check app tests` | 10 files already formatted |
| `ruff check app tests` | All checks passed |
| `pytest -q` | 2 passed, 1 warning (Starlette deprecation: `httpx` with `starlette.testclient`) |
| `npm run format:check` | Passed |
| `npm run lint` | Passed (no output) |
| `npm run typecheck` | Passed (no output) |
| `npm run test` | 1 file, 2 tests passed |
| `npm run build` | Succeeded; routes `/` and `/_not-found` prerendered |

The CI status of the latest push is user-reported, not observed here.
