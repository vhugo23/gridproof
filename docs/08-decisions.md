# GridProof — Decisions

**Document:** `docs/08-decisions.md`  
**Version:** 1.0 · 2026-10-17  
**Purpose:** Short record of decisions that guide implementation. Sources are cited. New decisions are added; superseded ones are marked, not deleted.

## Product and architecture (already in the specifications)

| ID | Decision | Source |
|---|---|---|
| D-01 | Independent, Cummins-inspired product. Not affiliated. All operational data is synthetic. Fridley is the only interactive lab. | CLAUDE.md, docs 01, 10 |
| D-02 | Modular-monolith FastAPI backend. No microservices, queues, Redis, Kafka, AWS or Kubernetes without a demonstrated requirement. | CLAUDE.md, doc 03 |
| D-03 | Deployment: Vercel (frontend), Render (backend), Neon (PostgreSQL). | CLAUDE.md, doc 03 |
| D-04 | Anonymous cookie workspaces with a fixed 7-day expiry from creation. Only the token hash is stored. | docs 03, 04, 05 |
| D-05 | Configuration versions and completed run evidence are immutable (append-only). | CLAUDE.md, doc 04 |
| D-06 | The simulator is a pure, deterministic Python module run synchronously in the API. Gemini is optional and drafts tests only. | CLAUDE.md, doc 03 |
| D-07 | PDF evidence is generated from a saved run and never re-runs the simulation. | docs 02, 10 |

## Decisions made on 2026-10-17 (project owner)

| ID | Decision |
|---|---|
| D-08 | **Session initialization is atomic.** `GET /api/v1/session` is exposed only when it creates the workspace, the default Fridley configuration and configuration version 1 in one transaction, rolling back on any failure. No interim workspace-only endpoint. Roadmap tasks: A-02 (`SystemConfigV1`), A-03 (atomic service), A-04 (endpoint). |
| D-09 | **F-11 precedes database-backed work.** Isolated PostgreSQL integration testing is a prerequisite for database-backed session and configuration features. Automated integration tests never run against production Neon. |
| D-10 | **The API contract is preserved.** The current `/health` response (`status`, `service`) does not match doc 05 API-01 (also `version`, `model_version`). The mismatch is an outstanding implementation issue (task C-11); the specification is not weakened. |
| D-11 | **Dependencies named in doc 03 are conditionally approved** (shadcn/ui, TanStack Query, Recharts, ReportLab, Playwright, Hypothesis, httpx) when the feature that needs them is implemented. Major new dependencies still require justification and approval. |
| D-12 | **PDF export** has implementation priority P1 but is required for the finished showcase. HTML-only export does not satisfy acceptance criteria. |
| D-13 | `CLAUDE.md` is a local instruction file and is ignored through `.git/info/exclude`, not the repository `.gitignore`. |
| D-14 | Document versions and dates change only when content changes substantively. Completed roadmap tasks are not reset. |

## Reconciliations applied on 2026-10-17

| Topic | Resolution |
|---|---|
| Layout and tooling | Docs now describe `frontend/` and `backend/`, npm, and no Docker Compose (none exists). |
| Facility count | Exactly three facilities in V1 (docs 01, 02, 10). |
| Session retention | Fixed 7 days from creation, no inactivity extension (docs 03, 04, 05). |
| Scenario limits | Doc 04 is authoritative: duration 1–600 s, 1–30 events, 1–20 assertions. Doc 03 refers to it. |
| Requirement ID and field names | `CRITICAL_LOAD_CONTINUITY` and `startup_delay_s` everywhere. |
| `run_idempotency` | Listed in doc 03's table list (it is defined in doc 04). |

## Open items (not yet decided)

- Source of the isolated PostgreSQL for F-11 (local container, Neon branch, or CI service container).
- Verified coordinates and source URLs for the three facilities (A-01). Doc 05's examples are placeholders.
- Cleanup mechanism for expired workspaces, rate-limit mechanism and stale-run recovery (docs 03/05 leave these open).
- Whether the stray empty directories `gridproof/` and `src/` at the repository root should be removed.
