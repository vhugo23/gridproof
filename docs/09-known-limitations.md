# GridProof — Known Limitations

**Document:** `docs/09-known-limitations.md`  
**Version:** 1.0 · 2026-10-17  
**Scope:** Limitations of the current repository, verified by inspection on 2026-10-17. Product and modeling limitations are in doc 01 §13 and doc 03 §6.

## Implementation gaps

| ID | Limitation | Planned resolution |
|---|---|---|
| L-01 | Backend routes: health, `GET /api/v1/facilities`, `GET /api/v1/session`, `GET /api/v1/configurations/current` and `POST /api/v1/configurations/{id}/versions`. No scenario or run endpoints exist. | Phase A onward |
| L-02 | `facility_catalog` is empty in Neon. The seed module exists (A-01) but has not been applied to Neon; that needs separate approval. | Apply with owner approval |
| L-03 | `GET /api/v1/health` returns `{status, service}`. The approved contract (doc 05 API-01) also requires `version` and `model_version`. | C-11 |
| L-04 | The original two backend tests mock the database. F-11 added real-PostgreSQL schema, migration and transaction tests, but CI confirmation is pending and there is no application code to test yet. | Confirm CI; extend with A-01 onward |
| L-05 | `SystemConfigV1` exists (A-02) but no workspace lifecycle, session endpoint or version-saving service uses it yet. | A-03 to A-06 |
| L-06 | No simulation engine, scenario model, run persistence or reports. | Phases C, D |
| L-07 | No MapLibre or 3D dependencies. The only page is a status page, and `layout.tsx` still has the default "Create Next App" metadata. | Phases B, E |
| L-08 | `ConnectionBadge` and its test exist, but no page uses the component. | Reuse or remove when the UI shell is built (E-01) |

## Workspace initialization notes (A-03)

- The service is reachable through `GET /api/v1/session` (A-04). Workspace-scoped routes (token lookup and expiry enforcement on protected reads) are A-05 and later.
- A fresh database (including Neon) needs the facility seed applied before any workspace can be created (`CatalogNotSeededError`). Seeding Neon still needs separate approval.
- Only the SHA-256 digest of the token is stored (decision D-19). A server-side pepper was not adopted; adding one later is a security change that needs approval.
- A caller that forgets to commit loses the workspace; A-04 must commit after a successful call and return the token only then.
- Cleanup of expired workspaces and their children is still undefined (docs 03/04 leave the mechanism open).
- Database error messages (for example a duplicate-hash violation) can contain the stored hash, never the plaintext token; A-04 must still keep such messages out of responses.

## Session endpoint notes (A-04)

- The issuance cap is global (120 per rolling 60 s), not per client. One abuser can make new demo sessions unavailable for everyone for up to a minute; existing sessions keep working.
- The cap counts `created_at` without an index (`ix_workspaces_expiry` covers only `expires_at`). Acceptable at demo scale; revisit with an index migration if the table grows large. Issuance is serialized by an advisory lock, so throughput is bounded to one issuing transaction at a time.
- The window uses the database transaction clock; a request that waited for the lock measures from its own transaction start.
- A commit with an unknown outcome (connection lost during commit) returns 503 without a cookie and may leave an unreachable workspace row; it expires and counts toward the cap. Cleanup of expired rows is still undefined.
- `GET /session` creates data (documented exception). Cross-site requests can trigger issuance within the cap; the response carries nothing worth stealing and the cookie is `SameSite=Lax`.
- `Secure` cookies work on `http://localhost` in Chrome and Firefox but not in Safari; use HTTPS or another browser for local manual checks.
- Cookie forwarding through the deployed Vercel rewrite to Render is still unproven. A-04 tests the backend behind forwarded headers and was checked by hand through the local `next dev` rewrite (`Set-Cookie`, `Cache-Control: no-store` and `Vary: Cookie` preserved; Next appends `Accept-Encoding` to `Vary`; reuse with the cookie returned `is_new:false`). That local check used the Docker test database, not Vercel or Render. Verify in staging (G-04).
- An unseeded database makes `/session` return 503 until the facility seed is applied.

## Current configuration notes (A-05)

- A workspace is expected to hold exactly one configuration (A-04 creates one). If more ever exist, the endpoint returns the one with the latest `updated_at` (then lowest id); there is no per-configuration selector.
- An unknown token and a token whose workspace row was removed by a future cleanup are both `SESSION_REQUIRED`; only an existing expired row yields `WORKSPACE_EXPIRED`. Expired-row cleanup remains undefined.
- Stored-data faults (pointer 0, missing version, invalid or unsupported snapshot) return `500` and are not repaired. The database check allows `latest_version = 0`, so that state is reachable by direct database edits only.
- The lookup is a read on every request with no caching and no session-activity tracking.

## Version saving notes (A-06)

- **CSRF:** Origin checking is defense in depth, not complete protection. A request without an `Origin` header is accepted (non-browser clients), and the allowlist cannot tell apart different pages of an allowed origin or other same-site origins. The remaining protection is `SameSite=Lax` (cookies are not sent on cross-site POSTs) and the `application/json` requirement. Same-site sibling origins and non-browser clients that obtain a cookie are not covered.
- **`FRONTEND_ORIGINS`:** unset or empty means every browser `Origin` is rejected, so the frontend's writes fail until it is configured on the backend host (local development: `http://localhost:3000`; production: the Vercel origin). Setting it on Render is a deployment action that has not been done.
- **Replay is content matching, not idempotency:** a different request with identical content sent right after a save is answered `200` with the existing version instead of `409`. It only covers the immediately previous version; there is no idempotency key for saves.
- **Names are not versioned:** the name is stored on the configuration row and overwritten by each save, so older versions carry no name. Anything needing the name at save time (reports, run evidence) must capture it itself.
- **No version cap or save rate limit:** each save stores one small normalized snapshot, but a workspace can create unlimited versions until its 7-day expiry. Adding a cap is a new product rule and needs approval.
- **Strict stored-data checks block saves:** if the latest stored version is corrupt, saves return `500` rather than appending over it (no silent repair).
- **Request framing:** the 256 KiB limit is enforced in the route on actual bytes read; the ASGI server itself has no separate body limit.

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
