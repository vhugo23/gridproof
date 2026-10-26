# GridProof

### Virtual Power Integration & Commissioning Workbench

**An independent, Cummins-inspired engineering project: five hands-on, synthetic-data workbenches for exploring power-system integration and engine test planning.**

**Live demo: https://gridproof-seven.vercel.app**

GridProof is a full-stack student engineering project inspired by publicly available information about Cummins Inc. It opens on a map of three public Cummins sites (Fridley, Minnesota; Seymour, Indiana; Daventry, United Kingdom) and offers five interactive experiences. Every number in them is synthetic: the equipment, configurations, packages, scenarios and sample values are invented for the exercises.

> **Independent and synthetic.** GridProof is not affiliated with, sponsored by, endorsed by or operated by Cummins Inc., and it is not the software, procedures or data of any Cummins site. It contains no real Cummins operational data, product specifications or measurements. Nothing it produces is certified analysis, a performance result or a product selection.

## The five workbenches

| Experience | Open from | What you do | Backend | Saved? |
|---|---|---|---|---|
| **Fridley virtual lab** | Fridley card, then **Enter Virtual Lab** (`#fridley-lab`) | Inspect a 2.5D power system (utility, two generators, battery, switchgear, critical load), change the G1 startup delay and battery settings, save a new configuration version, run a utility-outage startup test and compare the baseline (v1) with your latest version: requirement outcomes, event timeline and frame-by-frame playback. | Sessions, configurations, `startup-check` | Yes: an anonymous demo workspace |
| **Seymour engine test-plan workbench** | Seymour card (`#seymour-test-plan`) | Define an objective, speed/torque requirement regions and an ordered list of operating points; see theoretical shaft power, which requirements the plan covers, a traceability matrix, planned hold timeline and an evidence checklist. **Planning coverage only: the verification status is always `not_verified`.** | `engine-test-plan` | No |
| **Daventry capacity screening** | Daventry card (`#daventry-workbench`) | Screen a customer load (kW, power factor, margin) against four invented generator packages for real and apparent power. | `capacity-check` | No |
| **Mining duty-cycle analyzer** | Mining brief in *Industry Applications* (`#mining-duty-cycle`) | Enter power and duration segments and a cycle count; get energy per segment, per cycle and per shift. | `duty-cycle` | No |
| **Mobile-site power planner** | On-highway brief in *Industry Applications* (`#mobile-power-planner`) | List a temporary site's electrical loads with simultaneity factors; compare modeled demand with four invented packages. | `mobile-power` | No |

All five can also be opened from the "Five hands-on experiences" strip on the landing page, or directly by address. The Industry Applications gallery also holds short, illustrative briefs and two guided challenges that start in the Fridley lab.

The calculations run on the backend and the browser shows what the backend returns; nothing is recomputed in the UI. Each result lists its assumptions and what it does not model.

## What GridProof is not

- Not Cummins software, and not validated against any real equipment, plant, test cell or procedure.
- Not a certified electrical or engine analysis, a sizing or compliance tool, or a product-selection tool.
- Not a live view of any facility: the map shows approximate city-level locations with sourced public descriptions only.
- Not a general simulator. The Fridley lab runs one fixed, simplified utility-outage startup scenario (G1 readiness against a 10 s limit and critical-load continuity), documented in `docs/09-known-limitations.md`.
- Not implemented: PDF reports, 3D equipment viewing, a geographic tile map, AI-assisted test authoring, user accounts, or saving anything beyond the Fridley demo workspace.

## Architecture

```text
Browser
   |
   v
Next.js 16 / React 19 frontend  (Vercel)
   |  same-origin /api/v1/* rewrite
   v
FastAPI backend  (Render)
   |-- stateless calculation endpoints (no session, no database)
   |-- anonymous demo workspace, configurations and versions
   v
PostgreSQL  (Neon)
```

- **Stateless demo APIs.** `startup-check`, `capacity-check`, `duty-cycle`, `mobile-power` and `engine-test-plan` are pure, deterministic calculations. The last four need no cookie and no database. `startup-check` runs on a saved Fridley configuration version and so needs the demo session.
- **Anonymous workspace.** Entering the Fridley lab calls `GET /api/v1/session`, which creates a workspace with a fixed 7-day expiry and an `HttpOnly` cookie, and seeds a baseline configuration (v1). Saves create immutable new versions with optimistic concurrency. The first lab entry shows one `401` in the network log: the client tries to read the current configuration, and only on that expected 401 starts the session (documented in `docs/05-api-contracts.md`).
- **Facility catalog.** Three public sites, seeded into the database and returned by `GET /api/v1/facilities`.
- **Hash routing.** The workbenches are client-side views selected by the URL hash, so each has a shareable address and works with the browser's Back and Forward buttons.
- **Exact arithmetic.** The Daventry, Mining, Mobile Power and Seymour models use exact fractions or high-precision decimals and compare unrounded values; displayed numbers are rounded.

## Technology

| Layer | Technology |
|---|---|
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS 4, hand-built SVG for the map, lab and charts |
| Backend | Python 3.12, FastAPI, Pydantic 2 |
| Database | PostgreSQL (Neon), SQLAlchemy 2, Alembic migrations (001, 002), psycopg 3 |
| Testing | pytest (including isolated PostgreSQL integration tests), Vitest, React Testing Library |
| Quality | Ruff (backend), ESLint, Prettier, TypeScript strict checks |
| CI | GitHub Actions: Backend Checks and Frontend Checks on every push and pull request to `main` |
| Hosting | Vercel (frontend), Render (backend), Neon (database) |

## API endpoints

All paths are under `/api/v1`. The full contracts, validation bounds and error envelope are in [`docs/05-api-contracts.md`](docs/05-api-contracts.md); interactive docs are at `/docs` on a running backend.

| Endpoint | Purpose |
|---|---|
| `GET /health`, `GET /health/database` | Liveness and database connectivity |
| `GET /facilities` | Facility catalog (three public sites) |
| `GET /session` | Create or reuse the anonymous demo workspace |
| `GET /configurations/current` | Current Fridley configuration for the session's workspace |
| `POST /configurations/{id}/versions` | Save a new immutable configuration version |
| `POST /demo/startup-check` | Fridley utility-outage startup test (API-16) |
| `POST /demo/capacity-check` | Daventry capacity screening (API-17) |
| `POST /demo/duty-cycle` | Mining duty-cycle energy analysis (API-18) |
| `POST /demo/mobile-power` | Mobile-site power planner (API-19) |
| `POST /demo/engine-test-plan` | Seymour engine test-plan coverage (API-20) |

## Repository layout

```text
gridproof/
├── frontend/                    # Next.js application
│   └── src/
│       ├── app/                 # Next.js entry and global styles
│       ├── components/          # map, landing, lab, inspector, compare, challenges,
│       │                        #   daventry, mining, mobilepower, seymour, gallery
│       ├── lib/                 # API client, types, hooks, projection, recorded demo
│       └── test/                # shared test fixtures and setup
├── backend/
│   ├── app/
│   │   ├── core/                # settings, errors, Origin allowlist
│   │   ├── db/                  # SQLAlchemy models and sessions
│   │   ├── domain/              # pure calculation models and validation
│   │   ├── routes/              # FastAPI routers
│   │   ├── services/            # sessions, workspaces, configurations, startup check
│   │   ├── seed/                # facility catalog seed
│   │   └── main.py              # FastAPI entry point
│   ├── migrations/              # Alembic migration history
│   └── tests/                   # unit, API and PostgreSQL integration tests
├── docs/                        # specifications, decisions, status and limitations
└── .github/workflows/           # CI
```

## Local development

### Prerequisites

Node.js 24, npm, Python 3.12, Git, a PostgreSQL database (a local Docker database is fine; Neon works too) and Docker if you want to run the integration tests.

### 1. Backend

From `backend/`:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

On macOS or Linux use `python3.12 -m venv .venv` and `source .venv/bin/activate`.

Copy `backend/.env.example` to `backend/.env` and set your own database URL (never commit it):

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@HOST/gridproof?sslmode=require
# Browser origins allowed to POST to the API (comma separated). Needed for local use:
FRONTEND_ORIGINS=http://localhost:3000
```

Create the schema with Alembic (do not create tables by hand), seed the facility catalog, and start the API:

```powershell
python -m alembic upgrade head
python -m app.seed.facilities            # dry run: shows what would be written
python -m app.seed.facilities --apply    # writes the three facility rows
python -m uvicorn app.main:app --reload --port 8000
```

The seed refuses a non-loopback database unless you pass `--confirm-host <exact host>`. API docs: http://localhost:8000/docs. Health: http://localhost:8000/api/v1/health and http://localhost:8000/api/v1/health/database.

### 2. Frontend

From `frontend/`:

```bash
npm install
npm run dev
```

Open http://localhost:3000. The dev server forwards `/api/v1/*` to `http://127.0.0.1:8000`; set `API_PROXY_TARGET` to point it elsewhere.

## Testing and code quality

### Frontend (from `frontend/`)

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build
```

### Backend (from `backend/`)

```bash
python -m ruff format --check app tests migrations/env.py
python -m ruff check app tests migrations/env.py
python -m pytest -q
```

The PostgreSQL integration tests need an isolated database. Start the disposable one and point the tests at it (it is for tests only; never use real data):

```bash
docker compose -f docker-compose.test.yml up -d --wait
export DATABASE_URL=postgresql://gridproof:dummy@localhost:55432/gridproof
export TEST_DATABASE_URL=postgresql://gridproof:gridproof_test@127.0.0.1:55432/gridproof_test
export GRIDPROOF_REQUIRE_TEST_DB=1      # fail instead of skipping if the database is missing
python -m pytest -q
docker compose -f docker-compose.test.yml down -v
```

CI runs the same checks. The testing strategy and the observed results of each release are in [`docs/07-testing-strategy.md`](docs/07-testing-strategy.md).

## Documentation

- [Product Requirements](docs/01-product-requirements.md)
- [User Flows & Acceptance Criteria](docs/02-user-flows-and-acceptance-criteria.md)
- [System Architecture](docs/03-system-architecture.md)
- [Database Design](docs/04-database-design.md)
- [API Contracts](docs/05-api-contracts.md)
- [Development Log](docs/06-development-log.md)
- [Testing Strategy](docs/07-testing-strategy.md)
- [Decisions](docs/08-decisions.md)
- [Known Limitations](docs/09-known-limitations.md)
- [Implementation Roadmap](docs/10-implementation-roadmap.md)
- [Project Status](docs/PROJECT-STATUS.md)

## Limitations and responsible use

- Operational datasets and equipment configurations are synthetic. Facility descriptions come from public sources, and map markers are approximate city locations.
- The simulator and calculators are deliberately simple, state their assumptions, and are not validated against real equipment. Each workbench lists what it does not model (see `docs/09-known-limitations.md`).
- The Seymour workbench reports planning coverage only. A covered requirement does not show that an engine can operate at that point, and GridProof holds no measurements.
- Inputs are validated on the backend; secrets and credentials are never committed.
- The Fridley demo workspace is anonymous, holds only synthetic configuration data, and expires after 7 days.
- Browser support has been checked in headless Chromium only. Safari, Firefox and real touch devices have not been tested.

## Disclaimer

GridProof is an independent student engineering project inspired by publicly available Cummins information.

It is not affiliated with, sponsored by, endorsed by, or operated by Cummins Inc.

Cummins product names and facility references belong to their respective owners. All simulated systems, performance data, and operating scenarios are illustrative unless explicitly sourced.
