# GridProof

**Independent, Cummins-inspired virtual power integration and commissioning workbench.**

GridProof is a portfolio engineering project that models a synthetic microgrid, executes deterministic fault scenarios, and records requirements-linked evidence. The geographic facility map is informational; the Fridley-inspired virtual lab is simulated, not connected to live Cummins systems.

## Planned MVP
- Map-first navigation to verified Cummins facility context.
- 2.5D site visualization with a 3D equipment inspector.
- Editable, versioned generator, battery, switchgear, and load configuration.
- Repeatable discrete-event simulation with six test scenarios.
- Persisted immutable run results, comparison, and PDF reports.
- Optional Gemini-assisted scenario drafting; manual workflows always work.

## Planned stack
Next.js + TypeScript (Vercel), FastAPI + Python (Render), PostgreSQL (Neon), MapLibre, React Three Fiber for focused asset inspection, pytest, and Playwright.

## Project status
**Architecture and product planning.** Code has not been implemented. See [`docs/`](docs/) for requirements, user flows, architecture, database design, and API contracts.

## Repository layout
- `frontend/` — Next.js application (to be initialized)
- `backend/` — FastAPI application and simulation engine (to be initialized)
- `assets/` — properly licensed visual assets (to be added)
- `tests/` — cross-component acceptance tests (to be added)
- `docs/` — project specifications

## Disclaimer
Independent student project. Not affiliated with, endorsed by, or operating on behalf of Cummins Inc. All simulated operational data is synthetic; the simulator does not certify electrical systems.
