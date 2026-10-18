# GridProof — Known Limitations

**Document:** `docs/09-known-limitations.md`  
**Version:** 1.0 · 2026-10-17  
**Scope:** Limitations of the current repository, verified by inspection on 2026-10-17. Product and modeling limitations are in doc 01 §13 and doc 03 §6.

## Implementation gaps

| ID | Limitation | Planned resolution |
|---|---|---|
| L-01 | The only backend routes are `GET /api/v1/health` and `GET /api/v1/health/database`. No session, facility, configuration, scenario or run endpoints exist. | Phase A onward |
| L-02 | `facility_catalog` is empty in Neon. The seed module exists (A-01) but has not been applied to Neon; that needs separate approval. | Apply with owner approval |
| L-03 | `GET /api/v1/health` returns `{status, service}`. The approved contract (doc 05 API-01) also requires `version` and `model_version`. | C-11 |
| L-04 | The original two backend tests mock the database. F-11 added real-PostgreSQL schema, migration and transaction tests, but CI confirmation is pending and there is no application code to test yet. | Confirm CI; extend with A-01 onward |
| L-05 | `SystemConfigV1` exists (A-02) but no workspace lifecycle, session endpoint or version-saving service uses it yet. | A-03 to A-06 |
| L-06 | No simulation engine, scenario model, run persistence or reports. | Phases C, D |
| L-07 | No MapLibre or 3D dependencies. The only page is a status page, and `layout.tsx` still has the default "Create Next App" metadata. | Phases B, E |
| L-08 | `ConnectionBadge` and its test exist, but no page uses the component. | Reuse or remove when the UI shell is built (E-01) |

## Configuration schema notes (A-02)

- Docs 01, 02 and 03 mention an adjustable load bank, but `SystemConfigV1` has no load-bank field by design: `equipment.load.critical_kw` is the baseline load, `set_load_kw` scenario events change demand during a simulation, and the load-bank visualization shows that simulated demand (decision D-18; doc 05 v1.2).
- The schema accepts only whole numbers; the editor (A-07) must send integers.
- Only `config-v1` exists. `load_snapshot(schema_version, data)` is the explicit entry point for stored snapshots: any other recorded version raises `UnsupportedSchemaVersion` instead of being parsed with `config-v1` rules. A future `config-v2` needs its own module and a branch in that loader.

## API error handling (A-01b)

- Only `GET /api/v1/facilities` returns the doc 05 error envelope. `/api/v1/health/database` still returns FastAPI's default `{"detail": ...}` on 503, and request-validation (422) and other framework errors keep the default shape. There is no application-wide exception handler (decision D-17); converging the routes is a later task.
- Request IDs are generated per error response; a client-supplied `X-Request-ID` is ignored.

## Test invocation quirk

- Passing explicit file arguments that interleave `tests/integration/` files with `tests/` files (for example `integration/a.py tests/b.py integration/c.py`) makes pytest 9 lose the integration `conftest.py` for the later group (`fixture 'blank_engine' not found`). Reproduced with files that predate A-01b, so it is not caused by the endpoint code. `pytest -q`, `pytest tests/integration` and groupings that keep integration files together all pass.

## Facility catalog data (A-01)

- Marker coordinates are **approximate city locations** (Wikipedia: Fridley 45.08417, -93.25667; Seymour 38.95722, -85.89444; Daventry 52.25778, -1.16278), not plant coordinates. No facility-level coordinates were found in public sources, and none were invented. Each `source_note` states this.
- Source retrieval on 2026-10-17: the Seymour source (`investor.cummins.com`, news/detail/310) was retrieved and its text confirmed. The three `cummins.com` pages used for Fridley and Daventry (`/generators/power-integration-center`, `/en-na/eu/daventry-uk`) returned HTTP 403 to automated requests (a plain `curl` got 403 or 307), so their content was **not independently retrieved**; the purpose statements follow Cummins' text as shown in search results and are kept deliberately narrow. The project owner independently checked these Cummins sources in a browser on 2026-10-17 and confirmed that they support the documented business purposes.
- Cummins's 2022 press release and Daventry milestone release were also 403 and were not used as `source_url`.

## Schema behavior observed by integration tests

- `ck_configurations_name` uses `length(trim(name))`. PostgreSQL `trim()` removes spaces only, so a name consisting only of tabs or newlines passes the check (`test_configuration_name_check_trims_spaces_only`). `ConfigurationName` (A-02) rejects such names in application code, and `test_validator_closes_the_gap_the_database_check_leaves` documents the difference. The database constraint itself is unchanged (a schema change needs approval), so any path that bypasses the validator can still store them. A-03 and A-06 must use `ConfigurationName`.

## Configuration and tooling

| ID | Limitation | Note |
|---|---|---|
| L-09 | The proxy target in `frontend/next.config.ts` is hard-coded to `http://127.0.0.1:8000`. `NEXT_PUBLIC_API_BASE_URL` appears in `.env.example` but nothing reads it. | Must be addressed before deployment (G-03) |
| L-10 | CI installs frontend dependencies with `npm install`, not `npm ci`, because of a cross-platform lockfile issue. | F-10, G-02 |
| L-11 | `backend/requirements.txt` is UTF-16 LE with a byte-order mark (verified: first bytes `ff fe`). CI is user-reported green with it. Other tools or platforms may not read it. | Candidate to re-encode as UTF-8 when it next changes (needs approval) |
| L-12 | The `pytest` run emits a Starlette deprecation warning about `httpx` in `TestClient`. | Review when upgrading dependencies |
| L-13 | Both Alembic migrations are autogenerated and still carry the default boilerplate comments. Migration 001 inserts no data. | Informational |
| L-14 | `frontend/README.md` and `public/*.svg` are create-next-app defaults. | Informational |

## Repository hygiene

- Empty, untracked `gridproof/` and root `src/` directories exist. Git ignores empty directories. Not removed (needs owner approval).
- Root `tests/` and `assets/` contain only `.gitkeep`.
- Documentation 03 §4 describes a target layout (`routes`, `domain`, `simulation`, `services`); only `core` and `db` exist today.

## Unverified

- CI results are user-reported. They were not observed in this session.
- Behavior of `Set-Cookie` forwarding through the Vercel rewrite to Render is unproven (doc 03 §14).
- Render and Neon cold-start behavior is unmeasured.
