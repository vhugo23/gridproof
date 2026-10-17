# GridProof — API Contracts

**Document:** `docs/05-api-contracts.md`  
**Version:** 1.0 · 2026-10-17  
**Status:** API-first contract for implementation, not a claim that endpoints exist  
**Depends on:** [PRD](./01-product-requirements.md), [Flows](./02-user-flows-and-acceptance-criteria.md), [Architecture](./03-system-architecture.md), [Database](./04-database-design.md)

## 1. Conventions and security model

- **Base path:** `/api/v1`; browser calls same-origin Vercel `/api/v1/*`, proxied to FastAPI on Render. HTTPS only. JSON UTF-8 for all bodies except PDF response.
- **Anonymous demo authentication:** `GET /session` creates/renews a *new* 7-day workspace session or reuses an unexpired cookie. Response sets `gridproof_demo=<opaque>; Secure; HttpOnly; SameSite=Lax; Path=/`. All workspace operations require this cookie. No user accounts or bearer tokens in V1. `GET /health`, `GET /facilities`, and `GET /labs/fridley/assets` are public. `GET /scenarios` requires workspace because it includes personal drafts.
- **Workspace ownership:** derived from cookie, never accepted from client. Workspace mismatch returns `404 RESOURCE_NOT_FOUND`. Expired/missing cookie → `401 WORKSPACE_EXPIRED` (or `SESSION_REQUIRED` if first access). No silent session recreation on protected routes.
- **Unsafe requests:** `Origin` validation against configured frontend origins; `Content-Type: application/json`; JSON schema validation via Pydantic, no extra fields; no permissive credentialed CORS. POST `/runs` requires `Idempotency-Key` header (opaque 16–128 printable ASCII characters).
- **IDs:** UUID strings for mutable/persisted entities; public stable facility slug for catalog. Times are ISO 8601 UTC. Simulation relative time is integer milliseconds in stored/replay events (`at_ms`), while edit UI seconds are numeric (`*_s`). Power kW and energy kWh use explicit units.
- **Pagination:** `limit` integer 1..50, default 20; optional opaque `cursor` returned as `next_cursor`; results newest first. Cursor cannot grant cross-workspace access.
- **Schemas:** `SystemConfigV1`, `ScenarioV1`, `RunEvidenceV1` documented below and encoded in FastAPI/Pydantic. Backend OpenAPI is canonical; generate TS types during CI. All numbers finite; unknown fields rejected; max request 256 KiB, prompt 1,000 characters, bounded evidence output.
- **Versioning:** append-only configuration versions and scenario revisions; runs bind immutable IDs. Never silently update an executed run or reinterpret historical evidence.
- **HTTP status:** `200` read/validate/compare, `201` newly created saved object or completed synchronous run, `202` queued/pending run if execution not completed within request lifecycle, `400` invalid argument/header, `401` session, `403` CSRF/forbidden, `404` nonexistent/not-owned, `409` version or idempotency conflict, `415` content type, `422` schema/domain validation, `429` rate limit, `500` unexpected/PDF, `503` temporary dependency unavailable. Each route below specifies its main errors; unexpected failures use the same shape.

### Uniform error envelope
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "One or more fields are invalid.",
    "details": [{"field": "equipment.g1.startup_delay_s", "reason": "Must be between 0 and 120"}],
    "request_id": "req_01ABC"
  }
}
```
Do not return stack traces, secrets, cross-workspace existence, or raw Gemini provider payloads. Client shows user-friendly remediation and retains unsaved edits. Requests and responses can also include `X-Request-ID` for correlation.

### Domain schemas used across endpoints

**SystemConfigV1** (saved `snapshot`; example):
```json
{
  "facility_id": "fridley",
  "equipment": {
    "g1": {"rated_kw": 250, "startup_delay_s": 5, "enabled": true},
    "g2": {"rated_kw": 250, "startup_delay_s": 5, "enabled": true},
    "battery": {"inverter_kw": 250, "usable_kwh": 500, "initial_soc_pct": 80, "min_soc_pct": 20},
    "utility": {"available": true},
    "switchgear": {"mode": "auto"},
    "load": {"critical_kw": 180}
  }
}
```
`rated_kw`, `inverter_kw`, `usable_kwh`, topology, and asset IDs are fixed in V1 (must match seeded catalog), not arbitrary user-editable numbers. Editable config fields: `g1/g2.startup_delay_s` (0..120), `enabled` boolean, battery `initial_soc_pct` (0..100, >= min SOC), `critical_kw` (1..500), supported enumerated `switchgear.mode` (`auto` only for V1). Unknown IDs and unsupported values are rejected. Server validates cross-field rules.

**ScenarioV1** (saved `definition`; example):
```json
{
  "duration_s": 60,
  "events": [
    {"at_s": 0, "type": "utility_outage", "target_asset_id": "utility"},
    {"at_s": 0, "type": "start_generator", "target_asset_id": "g1"}
  ],
  "assertions": [
    {"requirement_id": "G1_READY_WITHIN_10S", "type": "asset_ready_within", "target_asset_id": "g1", "trigger_event_type": "start_generator", "max_delay_s": 10},
    {"requirement_id": "CRITICAL_LOAD_CONTINUITY", "type": "unserved_energy_at_most", "max_unserved_kwh": 0}
  ]
}
```
`duration_s` integer 1..600, 1..30 events, 1..20 assertions, integer `at_s` within run, unique `requirement_id`, supported assets/events/assertion types only. Allowed event types for V1: `utility_outage`, `utility_restore`, `start_generator`, `generator_start_failure`, `breaker_fail_close`, `set_load_kw`, `set_battery_soc_pct`. `set_load_kw` requires `value_kw` 1..500; `set_battery_soc_pct` requires `value_pct` 0..100. Other event types reject extra payloads. Explicit event ordering is normalized by timestamp and stable insertion-order tie-breaker; unsupported contradictions return validation errors.

**RunEvidenceV1** (abbreviated, one source for physical view, schematic and report):
```json
{
  "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "status": "completed",
  "model_version": "sim-v1",
  "config_version_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "scenario_revision_id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  "config_snapshot": {"facility_id": "fridley", "equipment": {}},
  "scenario_snapshot": {"duration_s": 60, "events": [], "assertions": []},
  "events": [{"id": "event-0001", "at_ms": 0, "type": "start_command", "asset_id": "g1", "details": {}}],
  "frames": [{"at_ms": 0, "assets": {"g1": {"state": "starting"}}, "served_load_kw": 180, "unserved_load_kw": 0, "battery_soc_pct": 80}],
  "metrics": {"unserved_energy_kwh": 0, "g1_ready_elapsed_s": 5},
  "assertions": [{"requirement_id": "G1_READY_WITHIN_10S", "status": "pass", "observed_seconds": 5, "threshold_seconds": 10, "evidence_event_ids": ["event-0001"]}],
  "created_at": "2026-10-17T16:00:00Z",
  "completed_at": "2026-10-17T16:00:01Z"
}
```
The example's empty snapshots are **abbreviation placeholders**, not valid persisted completed-run data. Actual completed runs include full validated inputs, ordered event logs, frames and assertions. For `error` runs, `error_code` is returned without a fabricated success metric. Model time is distinct from wall-clock run duration.

## 2. Public bootstrap and catalog endpoints

### API-01 `GET /health`
- **Auth:** public. **Params/body:** none.
- **200:** `{ "status": "ok", "service": "gridproof-api", "version": "1.0.0", "model_version": "sim-v1" }`.
- **Rules:** don't expose infrastructure URLs, database credentials, or detailed diagnostics. **Errors:** `503 SERVICE_UNAVAILABLE` if health check intentionally indicates unavailable; `500 INTERNAL_ERROR` unexpected.

### API-02 `GET /session`
- **Auth:** public bootstrap; may accept existing cookie. **Params/body:** none.
- **200:** `{ "workspace_id": "<uuid>", "expires_at": "2026-10-24T16:00:00Z", "is_new": true }` plus secure session cookie if newly issued. Reusing valid cookie returns `is_new:false` and unchanged fixed expiry.
- **Rules:** cryptographically random session token; store hash only; create initial Fridley configuration v1 transactionally. Expired cookie creates a **new** workspace only on explicit `/session` bootstrap, never while fetching old run routes. Rate-limit issuance.
- **Errors:** `429 SESSION_RATE_LIMITED`, `503 DATABASE_UNAVAILABLE`, `500 INTERNAL_ERROR`.

### API-03 `GET /facilities`
- **Auth:** public. **Params/body:** none.
- **200:** `{ "catalog_version": 1, "facilities": [{ "id":"fridley", "name":"Power Integration Center", "city":"Fridley", "region":"MN", "country":"US", "latitude": 45.0, "longitude": -93.0, "facility_type":"integration_testing", "is_interactive":true, "source_url":"https://...", "source_note":"Public facility context only; map coordinates verified in seed" }] }`.
- **Rules:** example coordinates/URL above are **placeholders**, not seed values. Must populate with verified public locations, attribute sources, and mark Seymour/Daventry `is_interactive:false`. No operational metrics or assumed physical layouts. **Errors:** `503 CATALOG_UNAVAILABLE`, `500 INTERNAL_ERROR`.

### API-04 `GET /labs/fridley/assets`
- **Auth:** public. **Params/body:** none.
- **200:** `{ "lab_id":"fridley", "asset_schema_version":"assets-v1", "synthetic":true, "assets":[{"id":"g1","type":"generator","label":"Generator G1","render":{"thumbnail_url":"/assets/g1.webp","model_url":"/assets/g1.glb","fallback_url":"/assets/g1.webp"},"selectable":true}],"connections":[{"from":"g1","to":"switchgear"}],"disclaimer":"Representative virtual lab, not Cummins equipment telemetry" }`.
- **Rules:** all URLs are same-origin, controlled licensed/static paths; fixed IDs match configuration and simulation; GLB may be null if unavailable and fallback image must exist; no editable real-world wiring. **Errors:** `404 LAB_NOT_FOUND` for unsupported lab path, `503 CATALOG_UNAVAILABLE`.

## 3. Configuration endpoints

### API-05 `GET /configurations/current`
- **Auth:** required workspace cookie. **Params/body:** none.
- **200:** `{ "configuration_id":"<uuid>", "name":"Fridley Test Configuration", "latest_version":1, "version_id":"<uuid>", "schema_version":"config-v1", "snapshot": <SystemConfigV1>, "saved_at":"<ISO UTC>" }`.
- **Rules:** only current workspace's default Fridley configuration; no implicit reset on errors; immutable version ID. **Errors:** `401 SESSION_REQUIRED/WORKSPACE_EXPIRED`, `404 CONFIGURATION_NOT_FOUND`, `503 DATABASE_UNAVAILABLE`.

### API-06 `POST /configurations/{configuration_id}/versions`
- **Auth:** required. **Path:** `configuration_id` UUID. **Headers:** `Content-Type: application/json`, Origin.
- **Body:** `{ "expected_version": 1, "name": "Fridley Test Configuration", "snapshot": <SystemConfigV1> }`.
- **201:** `{ "configuration_id":"<uuid>", "version_id":"<new_uuid>", "version_number":2, "schema_version":"config-v1", "saved_at":"<ISO UTC>" }`.
- **Validation:** path UUID; `expected_version` nonnegative integer matching latest; name 1..100; full snapshot exactly conforms to config schema; server-owned fixed equipment fields cannot be changed. Save is transactional, append-only.
- **Errors:** `400 INVALID_ID`, `401 SESSION_REQUIRED/WORKSPACE_EXPIRED`, `404 CONFIGURATION_NOT_FOUND`, `409 VERSION_CONFLICT` with `details.current_version`, `422 VALIDATION_ERROR`, `503 DATABASE_UNAVAILABLE`.
- **UI behavior:** keep local draft and offer reload/compare on 409; do not pretend save succeeded.

## 4. Scenario catalog, validation, and persistence

### API-07 `GET /scenarios`
- **Auth:** required. **Query:** `include_definitions` boolean, default `true` (optional); no workspace ID.
- **200:** `{ "scenarios": [{ "scenario_id":"<uuid>", "name":"Utility Outage", "template_origin":"seed", "is_read_only":true, "revision_id":"<uuid>", "revision":1, "schema_version":"scenario-v1", "definition":<ScenarioV1> }] }`.
- **Rules:** exactly six seeded global templates plus only this workspace's scenarios. Global templates read-only. **Errors:** `400 INVALID_QUERY`, `401 SESSION_REQUIRED`, `503 DATABASE_UNAVAILABLE`.

### API-08 `POST /scenarios/validate`
- **Auth:** required. **Body:** `{ "definition": <ScenarioV1> }`.
- **200 on valid:** `{ "valid":true, "normalized_definition":<ScenarioV1>, "warnings":[] }`.
- **422 on invalid:** uniform `VALIDATION_ERROR` with `details` per field; validation must not save anything or run simulation.
- **Rules:** syntactic + supported event/asset/assertion semantics; reject unsupported actions or contradictory simultaneous events; no silent auto-repair. **Other errors:** `401 SESSION_REQUIRED`, `415 UNSUPPORTED_MEDIA_TYPE`, `503 DATABASE_UNAVAILABLE` only if workspace resolution fails.

### API-09 `POST /scenarios`
- **Auth:** required. **Body (new):** `{ "name":"G1 startup check", "definition":<ScenarioV1> }`.
- **Body (new revision):** `{ "scenario_id":"<workspace_owned_uuid>", "expected_revision":1, "name":"G1 startup check", "definition":<ScenarioV1> }`.
- **Body (fork seed):** `{ "fork_from_revision_id":"<global_seed_revision_uuid>", "name":"Modified Utility Outage", "definition":<ScenarioV1> }`.
- **201 new/fork or 201 revision:** `{ "scenario_id":"<uuid>", "revision_id":"<uuid>", "revision":1, "name":"G1 startup check", "template_origin":"manual" }` (revision increments for edit, `template_origin` is `ai_draft_approved` only when an approved AI draft is explicitly saved and origin recorded; optional `origin` enum field must not be client-trusted).
- **Rules:** exactly one of `scenario_id`, `fork_from_revision_id`, or neither; name 1..100; valid definition; edit requires expected revision; fork allowed only from shared seed or owned revision; no writes to global template; AI draft doesn't save automatically. **Errors:** `401`, `404 SCENARIO_NOT_FOUND`, `409 REVISION_CONFLICT`, `422 VALIDATION_ERROR`, `503`.

## 5. Execution and evidence APIs

### API-10 `POST /runs`
- **Auth:** required. **Headers:** `Idempotency-Key` required, `Origin`, JSON Content-Type.
- **Body:** `{ "config_version_id":"<uuid>", "scenario_revision_id":"<uuid>" }`.
- **201 completed sync:** `{ "run_id":"<uuid>", "status":"completed", "created_at":"<ISO UTC>", "result_url":"/api/v1/runs/<uuid>" }`.
- **202 pending:** `{ "run_id":"<uuid>", "status":"pending", "result_url":"/api/v1/runs/<uuid>" }` when running asynchronously/recovered by polling; no fabricated completion. Same key + same payload returns original run representation with HTTP `200` (completed/error) or `202` (pending/running).
- **Rules:** resolve exact versions, verify workspace ownership or global template; snapshot inputs/model version; create pending run and idempotency row in one transaction; run deterministic bounded engine; state transitions only `pending→running→completed/error`; no Gemini call. Request duration target ≤5 s for seeded scenarios excluding UI rendering.
- **Errors:** `400 MISSING_IDEMPOTENCY_KEY/INVALID_ID`, `401`, `404 VERSION_NOT_FOUND`, `409 IDEMPOTENCY_CONFLICT`, `422 UNSUPPORTED_SIMULATION_INPUT`, `429 RUN_RATE_LIMITED`, `503 DATABASE_UNAVAILABLE`, `500 SIMULATION_FAILURE` (persist run as `error` when possible, never imply completed).

### API-11 `GET /runs`
- **Auth:** required. **Query:** `limit` 1..50 default 20, optional opaque `cursor`, optional `status` (`pending|running|completed|error`).
- **200:** `{ "items":[{"run_id":"<uuid>","status":"completed","created_at":"<ISO UTC>","config_version_id":"<uuid>","scenario_revision_id":"<uuid>","summary":{"passed":2,"failed":0}}],"next_cursor":null }`.
- **Rules:** only workspace runs, newest first; no full evidence in list. **Errors:** `400 INVALID_CURSOR`, `401`, `422 INVALID_QUERY`, `503`.

### API-12 `GET /runs/compare`
- **Auth:** required. **Query:** `left=<uuid>&right=<uuid>` mandatory; distinct IDs.
- **200:** `{ "left_run_id":"<uuid>", "right_run_id":"<uuid>", "comparable":true, "warnings":[], "changed_inputs":[{"path":"equipment.g1.startup_delay_s","left":5,"right":15}], "metric_differences":[{"name":"g1_ready_elapsed_s","left":5,"right":15,"delta":10}], "assertion_changes":[{"requirement_id":"G1_READY_WITHIN_10S","left":"pass","right":"fail"}] }`.
- **Rules:** compare **stored** completed runs, no rerun; if different scenario/model versions make direct metric comparisons invalid, set `comparable:false`, return warnings and suppress invalid derived deltas (can still show raw differences). **Errors:** `400 INVALID_ID/SAME_RUN`, `401`, `404 RUN_NOT_FOUND`, `409 RUN_NOT_COMPLETED`, `503`.
- **Route order:** register `/runs/compare` before `/runs/{run_id}` to avoid accidental dynamic-path interception.

### API-13 `GET /runs/{run_id}`
- **Auth:** required. **Path:** `run_id` UUID.
- **200:** `RunEvidenceV1` complete immutable saved snapshot for `completed` run. For `pending/running`, `200` `{ "id":"<uuid>", "status":"running", "created_at":"<ISO UTC>" }` with no fabricated events/assertions. For `error`, return status, error_code, timestamps and any safe metadata but no pass claim.
- **Rules:** workspace-qualified; replay uses stored `frames`/`events`; if large payload ever exceeds practical thresholds, evolve API rather than silently truncate. **Errors:** `400 INVALID_ID`, `401`, `404 RUN_NOT_FOUND`, `503`.

### API-14 `GET /runs/{run_id}/report.pdf`
- **Auth:** required. **Path:** `run_id` UUID. **Body/query:** none.
- **200:** binary `application/pdf`, `Content-Disposition: attachment; filename="gridproof-run-<uuid>.pdf"`; no-store cache headers.
- **Contents:** run ID, UTC timestamps, model/schema versions, full configuration/scenario identity and input values, relevant requirement thresholds, event evidence, computed metrics, pass/fail assertions, methodology/limitations, independent GridProof branding and Cummins non-affiliation notice. PDF is generated from saved completed run only.
- **Rules:** no rerun and no Gemini; escape all user-provided labels; only safe fonts/assets from application; prohibit user-supplied HTML/path. **Errors:** `401`, `404 RUN_NOT_FOUND`, `409 RUN_NOT_COMPLETED`, `500 REPORT_GENERATION_FAILED`, `503 DATABASE_UNAVAILABLE`.

## 6. Optional Gemini capability (P2)

### API-15 `POST /ai/scenario-draft`
- **Auth:** required. **Body:** `{ "prompt": "Simulate utility failure and a G1 startup delay; check G1 readiness within ten seconds.", "base_scenario_revision_id": "<optional_owned_or_seed_uuid>" }`.
- **200:** `{ "draft":<ScenarioV1>, "valid":true, "warnings":["Review equipment assumptions before saving."], "source":"gemini", "requires_review":true }`.
- **Validation:** prompt trimmed 10..1000 chars; optional base revision must be seed/owned; output strict JSON schema; validate with same server-side scenario validator as manual authoring. If LLM output fails schema validation, return `422 AI_DRAFT_INVALID` with repairable warnings **and never save/run it**. Do not accept commands to bypass validation or simulate physical control.
- **Usage:** user-triggered only; rate-limited and capped; server-only API key. Preserve prompt client-side if quota unavailable; user can use manual editor or predefined draft. Cached/replayed sample output must be labeled as sample—not live generation.
- **Errors:** `401`, `404 SCENARIO_NOT_FOUND`, `422 INVALID_PROMPT/AI_DRAFT_INVALID`, `429 AI_RATE_LIMITED`, `503 AI_UNAVAILABLE`, `504 AI_TIMEOUT`; other site functions remain available.

## 7. End-to-end contract examples

### Flagship regression (P0/P1)
1. `GET /session` → workspace + initial configuration v1 with G1 startup 5 s.
2. `GET /facilities` → map; select `fridley`; `GET /labs/fridley/assets` → physical scene.
3. `GET /scenarios` → choose saved scenario revision containing `start_generator g1` at t=0 and `G1_READY_WITHIN_10S` max 10 s; separately evaluate critical load continuity.
4. `POST /runs` with version 1 and scenario revision (unique idempotency key) → run A. Fetch evidence; G1 ready elapsed 5 s → readiness pass (according to seeded deterministic simulator).
5. `POST /configurations/{id}/versions` with `expected_version:1` and only G1 startup delay changed to 15 s → version 2.
6. `POST /runs` with config version 2 + same scenario revision (new idempotency key) → run B. G1 ready elapsed 15 s → readiness fail; continuity evaluated separately, not inferred.
7. `GET /runs/compare?left=A&right=B` → 5→15 s, readiness pass→fail; `GET /runs/B/report.pdf` → durable evidence based on saved run B.

The UI must not suggest actual Cummins firmware faults or certification outcomes; everything is synthetic.

### Version conflict and retry
- Save client A and B using `expected_version:1` simultaneously. Exactly one gets `201` version 2; the other `409 VERSION_CONFLICT` and retains draft.
- User double-clicks `Run`; same `Idempotency-Key` and payload returns the same run ID. A key reused for different inputs returns `409`, not a second run.
- API/db unavailable → `503`, clear UI retry, no phantom persisted record. Gemini unavailable → manual scenario authoring unaffected.

## 8. Contract tests / definition of done

- Public OpenAPI schemas describe all routes and example bodies; generated TypeScript types checked in CI.
- Validate each endpoint's success status, negative schema input, missing/expired workspace, cross-workspace ID, and dependency failures.
- Seeded six scenario templates are returned without duplications; modifying one creates a workspace fork.
- Invalid config save returns field-level `422` and leaves last stored version intact.
- Two concurrent saves produce one successful new config revision and one `409`.
- Repeated run POST using same key produces one logical run and identical evidence; same key different request → `409`.
- Runs tied to exact saved snapshots remain unchanged after later edits; results and PDF reference same run/model IDs.
- `G1_READY_WITHIN_10S` test passes for 5 s, fails for 15 s; critical load remains independently evaluated.
- Replay frames are sufficient to reconstruct physical scene and electrical diagram at identical time index.
- PDFs are valid, downloadable, include disclaimers and correct failed assertion evidence; PDF failures do not damage stored run.
- Gemini request blocked/invalid/over quota never prevents simulation, manual scenario editing or report export.
- Rate limiting, request body size and 7-day expiry validated in staging; no secrets in client bundle or logs.

## 9. Clarifications / evolution rules

- The architecture specifies *synchronous* bounded simulation as first choice; this document permits `202` and polling if a run remains pending, without requiring a queue or WebSocket in V1.
- There is no `PATCH` or `DELETE` API for historical run evidence. Session cleanup is the only default retention removal.
- No authentication accounts, public share links, real-time Cummins data, real equipment controls, real generator certification, or AWS deployment in this phase.
- Implement route ordering for `/runs/compare` vs `/runs/{run_id}` and never permit user-provided workspace ownership.
- If schema changes during development, update both Markdown documents and OpenAPI fixtures together. Do not change the already-approved product flow simply to fit implementation convenience.
