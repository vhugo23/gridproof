# GridProof — API Contracts

**Document:** `docs/05-api-contracts.md`  
**Version:** 1.9 · 2026-10-26 (1.9: API-19 Mobile-Site Power Planner; 1.8: API-18 Mining duty-cycle analysis; 1.7: API-17 Daventry capacity check; 1.6: API-16 demo startup check; 1.5: API-06 request checks, replay, errors and Origin allowlist; 1.4: API-05 authentication and stored-data error behavior; 1.3: API-02 session cookie, headers, errors and issuance cap specified, fixed-expiry wording; 1.2: SystemConfigV1 clarifications; 1.1: API-03 adds `description`; cache and error headers specified)  
**Status:** API-first contract for implementation, not a claim that endpoints exist  
**Depends on:** [PRD](./01-product-requirements.md), [Flows](./02-user-flows-and-acceptance-criteria.md), [Architecture](./03-system-architecture.md), [Database](./04-database-design.md)

## 1. Conventions and security model

- **Base path:** `/api/v1`; browser calls same-origin Vercel `/api/v1/*`, proxied to FastAPI on Render. HTTPS only. JSON UTF-8 for all bodies except PDF response.
- **Anonymous demo authentication:** `GET /session` creates a *new* workspace with a fixed 7-day expiry (never renewed) or reuses an unexpired cookie. A newly issued session sets `gridproof_demo=<opaque>; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=<remaining seconds>` (no `Domain`). All workspace operations require this cookie. No user accounts or bearer tokens in V1. `GET /health`, `GET /facilities`, and `GET /labs/fridley/assets` are public. `GET /scenarios` requires workspace because it includes personal drafts.
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

**V1 clarifications (1.2).** `battery.min_soc_pct` must equal 20 and `utility.available` must equal `true` in V1; they are fixed, not editable (utility outages are scenario events). Every numeric field is a whole number: booleans, decimals (including `5.0`), strings and non-finite numbers are rejected. `load.critical_kw` is the **baseline** critical load; demand changes during a run come from `set_load_kw` scenario events, and the load-bank visualization shows that simulated demand, so `SystemConfigV1` has no load-bank field. Validation errors map to `details[{field, reason}]` with dotted paths such as `equipment.g1.startup_delay_s`; reasons never echo submitted values. A configuration `name` is trimmed, 1..100 characters, contains no control characters and has at least one visible character.

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
- **200:** `{ "workspace_id": "<uuid>", "expires_at": "2026-10-24T16:00:00Z", "is_new": true }` plus secure session cookie if newly issued. Reusing valid cookie returns `is_new:false`, the unchanged fixed expiry and **no** `Set-Cookie`. The token never appears in the body.
- **Headers (all responses, including errors):** `Cache-Control: no-store`, `Vary: Cookie`, `X-Request-ID`. Cookie attributes: `HttpOnly; Secure` (always, regardless of proxy headers); `SameSite=Lax; Path=/`; host-only (no `Domain`); `Max-Age` = seconds until the fixed expiry.
- **Cookie handling:** a missing, malformed (not a 43-character URL-safe token), unknown or expired cookie, or more than one `gridproof_demo` cookie, is treated as no session and a new workspace is issued; no value is chosen from duplicates.
- **Side effects:** documented exception to GET safety: a request without a valid session creates a workspace. Clients call it explicitly (no prefetching). The cookie is set only after the creating transaction committed.
- **Rules:** cryptographically random session token; store hash only; create initial Fridley configuration v1 transactionally. Expired cookie creates a **new** workspace only on explicit `/session` bootstrap, never while fetching old run routes. Issuance is capped globally at 120 new workspaces per rolling 60 seconds (workspace `created_at`), serialized with a transaction-scoped PostgreSQL advisory lock with bounded lock and statement timeouts. Reusing a valid session is never limited or blocked by the cap.
- **Errors:** `429 SESSION_RATE_LIMITED` (`Retry-After: 60`; no cookie); `503 DATABASE_UNAVAILABLE` (database failure, unseeded facility catalog, or issuance lock wait timeout; the lock timeout also sends `Retry-After: 5`; generic message, no cookie, no rows left behind); `500 INTERNAL_ERROR`.

### API-03 `GET /facilities`
- **Auth:** public. **Params/body:** none.
- **200:** `{ "catalog_version": 1, "facilities": [{ "id":"fridley", "name":"Power Integration Center", "city":"Fridley", "region":"MN", "country":"US", "latitude": 45.0, "longitude": -93.0, "facility_type":"integration_testing", "is_interactive":true, "description":"Public context text.", "source_url":"https://...", "source_note":"Public facility context only; map marker is an approximate city location" }] }`. `description` (added in 1.1, additive) is the verified public context shown on facility cards.
- **Rules:** example coordinates/URL above are **placeholders**, not seed values. Must populate with verified public locations, attribute sources, and mark Seymour/Daventry `is_interactive:false`. No operational metrics or assumed physical layouts; no workspace or synthetic-lab data. Coordinates are approximate city locations and `source_note` says so. **Caching:** `200` carries `Cache-Control: public, max-age=300`; every error response carries `Cache-Control: no-store` and an `X-Request-ID` equal to `error.request_id`. **Errors:** `503 CATALOG_UNAVAILABLE` (database failure or an empty catalog), `500 INTERNAL_ERROR`.

### API-04 `GET /labs/fridley/assets`
- **Auth:** public. **Params/body:** none.
- **200:** `{ "lab_id":"fridley", "asset_schema_version":"assets-v1", "synthetic":true, "assets":[{"id":"g1","type":"generator","label":"Generator G1","render":{"thumbnail_url":"/assets/g1.webp","model_url":"/assets/g1.glb","fallback_url":"/assets/g1.webp"},"selectable":true}],"connections":[{"from":"g1","to":"switchgear"}],"disclaimer":"Representative virtual lab, not Cummins equipment telemetry" }`.
- **Rules:** all URLs are same-origin, controlled licensed/static paths; fixed IDs match configuration and simulation; GLB may be null if unavailable and fallback image must exist; no editable real-world wiring. **Errors:** `404 LAB_NOT_FOUND` for unsupported lab path, `503 CATALOG_UNAVAILABLE`.

## 3. Configuration endpoints

### API-05 `GET /configurations/current`
- **Auth:** required workspace cookie. **Params/body:** none.
- **200:** `{ "configuration_id":"<uuid>", "name":"Fridley Test Configuration", "latest_version":1, "version_id":"<uuid>", "schema_version":"config-v1", "snapshot": <SystemConfigV1>, "saved_at":"<ISO UTC>" }`.
- **Rules:** only the authenticated workspace's current configuration; the workspace comes solely from the session cookie (no workspace or configuration identifier is accepted); the returned version is the one named by `latest_version`; the snapshot is validated by its stored `schema_version` and returned in normalized form; no implicit reset or repair on errors; immutable version ID. This route never creates or renews a session and never sets a cookie.
- **Headers (all responses, including errors):** `Cache-Control: no-store`, `Vary: Cookie`, `X-Request-ID`.
- **Errors:** `401 SESSION_REQUIRED` (cookie missing, malformed, duplicated, or matching no workspace); `401 WORKSPACE_EXPIRED` (well-formed cookie matching an existing workspace whose fixed expiry has passed); `404 CONFIGURATION_NOT_FOUND` (active workspace without a configuration record); `500 INTERNAL_ERROR` (stored data fault: unsupported `schema_version`, a snapshot that fails validation, or a configuration whose `latest_version` is 0 or names a missing version; the response never includes stored data); `503 DATABASE_UNAVAILABLE`. Both `401` codes tell the client to call `GET /session` explicitly.

### API-06 `POST /configurations/{configuration_id}/versions`
- **Auth:** required (session cookie; the workspace never comes from the request). **Path:** `configuration_id` UUID. **Headers:** `Content-Type: application/json` (`charset` parameter allowed); `Origin`, when present, must be on the `FRONTEND_ORIGINS` allowlist.
- **Body:** `{ "expected_version": 1, "name": "Fridley Test Configuration", "snapshot": <SystemConfigV1> }`.
- **201:** `{ "configuration_id":"<uuid>", "version_id":"<new_uuid>", "version_number":2, "schema_version":"config-v1", "saved_at":"<ISO UTC>" }`. The response is sent only after the transaction committed. `schema_version` is decided by the server; a client-supplied one is rejected.
- **200 (best-effort replay):** if `expected_version + 1` equals the current `latest_version` and the submitted name and validated snapshot are identical to the stored ones, the existing version's metadata is returned and nothing is created. This makes a retry after a lost response safe; it is content matching, **not** true request idempotency (it cannot tell a retry from a different request with identical content).
- **Validation:** path UUID; `expected_version` a strict integer 0..2147483647 (booleans, decimals and strings rejected; `0` is accepted but never matches a valid configuration); name by the `ConfigurationName` rules (trimmed, 1..100 characters, no control characters, a visible character); snapshot exactly conforms to `SystemConfigV1` and must name the configuration's facility; unknown fields are rejected; server-owned fixed equipment fields cannot be changed. JSON must be well formed, with no duplicate keys and no `NaN`/`Infinity`. Body limit 256 KiB measured from the actual bytes. Save is transactional, append-only: the configuration row is locked (`SELECT ... FOR UPDATE`, scoped by workspace), the new version number is `latest_version + 1` from the locked row, and the version insert, name update and `latest_version` advance commit together. Lock and statement waits are bounded and transaction-local. Stored data is validated through its recorded `schema_version` before a save or replay is accepted; a `latest_version` of 0, a pointer naming a missing version, or an invalid stored snapshot is `500` and is never repaired by a save.
- **Errors** (all in the uniform envelope with `X-Request-ID`, `Cache-Control: no-store`, `Vary: Cookie`; no submitted value is echoed): `403 FORBIDDEN` (Origin present and not allowed; checked first; with no allowlist configured every browser Origin is rejected); `401 SESSION_REQUIRED/WORKSPACE_EXPIRED`; `400 INVALID_ID`; `415 UNSUPPORTED_MEDIA_TYPE`; `413 PAYLOAD_TOO_LARGE`; `422 VALIDATION_ERROR` (malformed JSON is `[{"field":"(body)","reason":"Malformed JSON"}]`); `404 CONFIGURATION_NOT_FOUND` (missing and not-owned ids are indistinguishable); `409 VERSION_CONFLICT` with `details: [{"field":"current_version","reason":"<n>"}]`; `500 INTERNAL_ERROR` (stored data fault); `503 DATABASE_UNAVAILABLE` (database failure, or a lock wait timeout, which also sends `Retry-After: 5`). Origin checking is defense in depth, not complete CSRF protection: requests without an `Origin` header are accepted and same-site origins are not distinguished.
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

### API-16 `POST /demo/startup-check` (conference demo; stateless, not a run)
- **Purpose:** evaluate one saved, immutable configuration version against a fixed utility-outage scenario and return deterministic evidence. It **creates nothing**: no run row, no idempotency key, no migration. It does not replace API-10; persisted runs, scenarios and PDF evidence remain planned (Phase C/D). The result is not an auditable run of record.
- **Auth:** required session cookie; the workspace comes only from the cookie. `Origin`, when present, must be on the `FRONTEND_ORIGINS` allowlist (checked first, same rules as API-06). **Headers:** `Content-Type: application/json` (`charset` allowed).
- **Body (4 KiB limit):** `{ "configuration_id": "<uuid>", "version_number": 1 }`. `version_number` is a strict integer 1..2147483647. Unknown fields are rejected, so equipment values, snapshots and workspace identifiers cannot be supplied: every value comes from the stored version. Duplicate keys, malformed JSON and `NaN` are `422`.
- **200:** `{ model_version:"startup-check-v1", source:{configuration_id, version_id, version_number, schema_version}, scenario:{id, horizon_ms:300000, outage_at_ms, outage_detection_ms, transfer_delay_ms, commanded_generators:["g1"]}, assumptions:[{id,text}], inputs:{...values read from the saved version...}, events:[{id:"evt-01", at_ms, type, asset, description}], frames:[{event_id, at_ms, states:{utility,g1,g2,battery,load}, power_kw:{g1_kw,battery_kw,load_kw,served_kw,unserved_kw}, battery_soc_pct, battery_energy_remaining_kwh}], metrics:{g1_ready_ms, g1_transfer_complete_ms, battery_depleted_ms, battery_bridge_energy_kwh, battery_energy_delivered_kwh, unserved_energy_kwh, battery_peak_kw, battery_soc_end_pct}, requirements:[{requirement_id, type, status:"pass"|"fail", comparator:"<=", observed, threshold, unit:"ms"|"kWh", evidence_event_ids, explanation}] }`. Times are integer milliseconds; one frame exists per event (state immediately after it), so the same response drives the timeline, equipment states and comparison. Headers: `Cache-Control: no-store`, `Vary: Cookie`, `X-Request-ID`; no cookie is set.
- **Scenario and requirements:** the utility is lost at t = 0 and only G1 is commanded to start (G2 is not commanded even when enabled). `G1_READY_WITHIN_10S` passes when G1 reaches ready within 10 000 ms of the outage (inclusive) and is judged on readiness, not on load transfer. `CRITICAL_LOAD_CONTINUITY` passes only when unserved energy is exactly 0. These differ from doc 05's `RunEvidenceV1` field names (`observed`/`threshold` with a `unit`, in ms, instead of `observed_seconds`); this endpoint's shape is demo-scoped.
- **Model rules (all stated in `assumptions`):** 300 s horizon; outage detection and generator transfer delays are 0 ms (readiness and transfer remain distinct events); the battery picks up the load with no gap; after transfer G1 supplies up to 250 kW and the battery supplies the residual up to its inverter rating and remaining energy; available battery energy = `usable_kwh × (initial_soc_pct − min_soc_pct) / 100` with no losses; shortfall above the inverter rating or after depletion is unserved energy. Time and energy are exact integers internally (ms, kW·ms); only serialized kWh (6 decimals) and SoC (4 decimals) are rounded, and requirements use the exact values. Events at equal timestamps are ordered `utility_outage`, `start_generator`, `battery_depleted`, `g1_ready`, `g1_transfer_complete`, `horizon_reached` (an empty battery is recorded before generator events at that instant); events at or before the horizon are recorded. Frames are discrete state snapshots taken right after each event, not energy-integration intervals: clients must display `metrics` and never recompute energy from frames. In every frame an empty battery delivers 0 kW. The same saved version always gives byte-identical output. Results come only from this model and are synthetic; they say nothing about real equipment.
- **Errors** (uniform envelope, `X-Request-ID`, `Cache-Control: no-store`, `Vary: Cookie`): `403 FORBIDDEN` (Origin not allowed); `401 SESSION_REQUIRED/WORKSPACE_EXPIRED`; `415 UNSUPPORTED_MEDIA_TYPE`; `413 PAYLOAD_TOO_LARGE`; `422 VALIDATION_ERROR`; `404 CONFIGURATION_NOT_FOUND` (missing configuration, not-owned configuration and missing version are indistinguishable); `500 INTERNAL_ERROR` (stored data fault; never repaired, no stored data in the response); `503 DATABASE_UNAVAILABLE`. The database transaction is set read-only first, so this route cannot write.

### API-17 `POST /demo/capacity-check` (Daventry synthetic workbench; stateless, no session)
- **Purpose:** screen one customer requirement against four fixed, invented generator packages and return deterministic evidence. It creates nothing, needs no cookie and no database, and is independent of `SystemConfigV1`, the Fridley generators and API-16.
- **Auth:** none; no cookie is read or set. `Origin`, when present, must be on the `FRONTEND_ORIGINS` allowlist (checked first, same rules as API-06). **Headers:** `Content-Type: application/json` (`charset` allowed).
- **Body (4 KiB limit):** `{ "real_power_kw": 400, "power_factor": 0.8, "capacity_margin_pct": 0 }`. `real_power_kw` is a strict integer 1..2000. `power_factor` is a JSON number 0.50..1.00 with at most 2 decimal places, parsed exactly (decimal, not binary float); strings, booleans and null are rejected. `capacity_margin_pct` is optional, a strict integer 0..50, default 0. Unknown fields are rejected. Duplicate keys, `NaN`/`Infinity`, malformed JSON and unrepresentable numbers give `422`.
- **200:** `{ model_version:"capacity-check-v1", inputs:{real_power_kw, power_factor, capacity_margin_pct}, demand:{real_power_kw, apparent_power_kva, required_kw, required_kva}, assumptions:[{id,text}], packages:[{id, label, rated_kw, rated_kva, rated_power_factor, requirements:[{requirement_id:"KW_CAPACITY"|"KVA_CAPACITY", status:"pass"|"fail", comparator:"<=", required, capacity, unit:"kW"|"kVA", margin, margin_pct_of_required, explanation}], both_requirements_pass}] }`. Packages are always `synthetic-a` to `synthetic-d` (200/250, 320/400, 480/600, 640/800 kW/kVA). Headers: `Cache-Control: no-store`, `X-Request-ID`.
- **Model rules (also returned in `assumptions`):** demand kVA = kW / power factor; required kW = kW x (1 + margin/100); required kVA = demand kVA x (1 + margin/100); each requirement passes when required <= rating (equality passes); the two requirements are judged separately; verdicts use exact rational arithmetic and displayed values are rounded half up to 2 decimals; `margin` = rating - required (negative when failing) and `margin_pct_of_required` = margin / required x 100. There is no score, ranking or recommendation. Not checked: derating, step loading, paralleling, fuel, cooling, noise, emissions, site constraints. The packages are not Cummins products.
- **Errors** (uniform envelope, `X-Request-ID`, `Cache-Control: no-store`): `403 FORBIDDEN` (Origin not allowed); `415 UNSUPPORTED_MEDIA_TYPE`; `413 PAYLOAD_TOO_LARGE`; `422 VALIDATION_ERROR` with `details:[{field, reason}]` (submitted values are never echoed); `500 INTERNAL_ERROR`. There is no 401, 404 or 503.

### API-18 `POST /demo/duty-cycle` (Mining duty-cycle energy analyzer; stateless, no session)
- **Purpose:** turn the power-versus-time segments a user enters into energy per segment, per cycle and per shift, and say which segment uses the most energy. It creates nothing, needs no cookie and no database, and is independent of `SystemConfigV1`, the Fridley lab, API-16 and API-17. It is a calculator over the user's own numbers: it uses no equipment data and is not a vehicle, fuel, range or propulsion model.
- **Auth:** none; no cookie is read or set. `Origin`, when present, must be on the `FRONTEND_ORIGINS` allowlist (checked first, same rules as API-06). **Headers:** `Content-Type: application/json` (`charset` allowed).
- **Body (4 KiB limit):** `{ "segments": [{ "name": "Hauling", "power_kw": 300, "duration_min": 12 }], "cycles_per_shift": 18 }`. `segments` is a list of 1..12. `name` is text, trimmed, 1..40 characters, no control characters, at least one visible character, and unique ignoring case. `power_kw` is a JSON number 0..10000 with at most 2 decimal places (0 allowed; negative power and regeneration are not modeled). `duration_min` is a JSON number greater than 0 and at most 480 with at most 2 decimal places. Numbers are parsed exactly (decimal, not binary float); strings, booleans and null are rejected. `cycles_per_shift` is a strict integer 1..500. Unknown fields, duplicate keys, `NaN`/`Infinity`, malformed JSON and unrepresentable numbers give `422`.
- **Shift limit:** total cycle duration x `cycles_per_shift` must not exceed 1,440 minutes. A violation is a `422` detail on field `cycles_per_shift`, naming how many cycles fit ("... at most 57 cycles fit this cycle") or, when one cycle alone is longer than 1,440 minutes, saying to shorten the segments. Cross-field rules (this limit and duplicate names, reported on `segments.N.name`) run only after every single field is valid. Detail `field` values are paths such as `segments.1.power_kw`.
- **200:** `{ model_version:"duty-cycle-v1", inputs:{segments:[{name,power_kw,duration_min}], cycles_per_shift}, segments:[{id:"segment-N", name, power_kw, duration_min, energy_kwh, share_of_cycle_energy_pct, is_dominant}], cycle:{duration_min, energy_kwh, average_power_kw, peak_power_kw}, shift:{cycles, duration_min, energy_kwh}, dominant_segment_ids:[...], explanation, assumptions:[{id,text}] }`. Headers: `Cache-Control: no-store`, `X-Request-ID`.
- **Model rules (also returned in `assumptions`):** segment energy kWh = kW x min / 60; cycle energy = sum of segment energies; cycle duration = sum of minutes; shift energy = cycle energy x cycles; shift duration = cycle minutes x cycles; average power = cycle energy x 60 / cycle minutes (time-weighted); peak power = the largest segment kW; share = segment energy / cycle energy x 100 (0 when the cycle has no energy). The dominant segment is the one with the largest exact energy; segments with exactly equal energy are all returned in `dominant_segment_ids`, and the list is empty when the cycle has no energy. All values and comparisons use exact rational arithmetic; only the serialized values are rounded half up to 2 decimals, so rounded shares can add up to slightly more or less than 100. `explanation` is text written by the server (the dominant segment's energy, share, power and share of cycle time, and the highest-power segment when different); clients display it and never recompute energy, shares, totals or dominance. There is no score, ranking or recommendation. Not modeled: fuel use, vehicle range, propulsion, efficiency or losses, auxiliary loads, emissions, battery or generator sizing. Sample values shown in the UI are invented and are not haul-truck or Cummins data.
- **Errors** (uniform envelope, `X-Request-ID`, `Cache-Control: no-store`): `403 FORBIDDEN` (Origin not allowed); `415 UNSUPPORTED_MEDIA_TYPE`; `413 PAYLOAD_TOO_LARGE`; `422 VALIDATION_ERROR` with `details:[{field, reason}]` (submitted values are never echoed); `500 INTERNAL_ERROR`. There is no 401, 404 or 503.

### API-19 `POST /demo/mobile-power` (Mobile-Site Power Planner; stateless, no session)
- **Purpose:** turn the named electrical loads of a temporary mobile-powered site into connected load, simultaneous (modeled) demand, required capacity with margin and each load's contribution, and compare them with four fixed, invented mobile power packages. It creates nothing, needs no cookie and no database, and is independent of `SystemConfigV1`, the Fridley lab and API-16 to API-18. It models the site's electrical demand, not a truck or trailer, and uses no equipment data.
- **Auth:** none; no cookie is read or set. `Origin`, when present, must be on the `FRONTEND_ORIGINS` allowlist (checked first, same rules as API-06). **Headers:** `Content-Type: application/json` (`charset` allowed).
- **Body (4 KiB limit):** `{ "loads": [{ "name": "Welding machines", "quantity": 3, "rated_kw": 12.00, "simultaneity_factor": 0.5 }], "capacity_margin_pct": 25 }`. `loads` is a list of 1..12. `name` is text, trimmed, 1..40 characters, no control characters, at least one visible character, unique ignoring case. `quantity` is a strict integer 1..100. `rated_kw` is a JSON number greater than 0 and at most 500 with at most 2 decimal places. `simultaneity_factor` is a JSON number 0.01..1.00 with at most 2 decimal places (0 is rejected: remove an unused load). `capacity_margin_pct` is optional, a strict integer 0..50, default 0. Numbers are parsed exactly (decimal, not binary float); strings, booleans and null are rejected. Unknown fields, duplicate keys, `NaN`/`Infinity`, malformed JSON and unrepresentable numbers give `422`.
- **Cross-field rules** (run only after every single field is valid): total connected load (sum of quantity x rated kW) must not exceed 2,000 kW, a `422` detail on field `loads` that never repeats submitted values; duplicate names are reported on `loads.N.name` of the later load. Detail `field` values are paths such as `loads.1.rated_kw`.
- **200:** `{ model_version:"mobile-power-v1", inputs:{loads:[{name,quantity,rated_kw,simultaneity_factor}], capacity_margin_pct}, loads:[{id:"load-N", name, quantity, rated_kw, simultaneity_factor, connected_kw, demand_kw, share_of_demand_pct, is_dominant}], totals:{connected_kw, demand_kw, overall_simultaneity_pct, required_kw, all_simultaneous_required_kw}, dominant_load_ids:[...], packages:[{id:"mobile-m1".."mobile-m4", label, rated_kw, modeled_demand:{status:"meets"|"does_not_meet", comparator:"<=", required, capacity, headroom_kw, utilization_pct}, all_simultaneous:{...same}, category:"does_not_meet_modeled"|"meets_modeled_only"|"meets_modeled_and_all_simultaneous", category_label, explanation}], explanation, assumptions:[{id,text}] }`. Packages are always M1 to M4 at 30, 60, 100 and 150 kW, in that order. Loads are reported in the order entered. Headers: `Cache-Control: no-store`, `X-Request-ID`.
- **Model rules (also returned in `assumptions`):** connected kW = quantity x rated kW; demand kW = connected kW x simultaneity factor; modeled demand = sum of demand kW; overall simultaneity = demand / connected x 100; required = modeled demand x (1 + margin/100); all-simultaneous requirement = connected load x (1 + margin/100) (the sensitivity case in which every load runs at once); share = load demand / modeled demand x 100. Each package is compared on its rated kW with both requirements; equality passes; headroom = rating - requirement (negative when the requirement is above the rating, never negative zero) and utilization = requirement / rating x 100. Categories are neutral: `does_not_meet_modeled` ("Does not meet modeled demand"), `meets_modeled_only` ("Meets modeled demand only") and `meets_modeled_and_all_simultaneous` ("Meets both modeled and all-simultaneous demand"). The dominant load is the one with the largest exact demand; exactly equal demands are all returned. All values and comparisons use exact rational arithmetic and only serialized values are rounded half up to 2 decimals, so a requirement that displays equal to a rating can still fail (80.01 kW at a 25% margin is exactly 100.0125 kW and fails the 100 kW package; 320.01 kW at factor 0.25 and 25% margin is 100.003125 kW, displays as 100.00 and fails, and the package explanation says so). `explanation` texts are written by the server; clients display them and never recompute totals, shares, headroom, utilization, verdicts or categories. There is no score, ranking or recommendation; packages are listed by rating.
- **Stated limits:** simultaneity factors are user-entered planning assumptions, not measured peak concurrency or a physical operating schedule. The model screens steady-state real power (kW) only and does not validate kVA, power factor, voltage, motor starting, step loading, derating, protection, fuel, emissions or full equipment suitability. The packages are invented and are not Cummins products; the sample values shown in the UI are invented.
- **Errors** (uniform envelope, `X-Request-ID`, `Cache-Control: no-store`): `403 FORBIDDEN` (Origin not allowed); `415 UNSUPPORTED_MEDIA_TYPE`; `413 PAYLOAD_TOO_LARGE`; `422 VALIDATION_ERROR` with `details:[{field, reason}]` (submitted values are never echoed); `500 INTERNAL_ERROR`. There is no 401, 404 or 503.

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
