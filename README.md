
# GridProof

### Virtual Power Integration & Commissioning Workbench

**An independent, Cummins-inspired engineering platform for testing integrated power systems against operational and failure-response requirements.**

GridProof is a full-stack software engineering project inspired by Cummins Power Systems and its Power Integration Center (PIC) in Fridley, Minnesota.

The platform is designed to let engineers configure representative power systems, simulate equipment failures, validate acceptance criteria, and generate traceable engineering evidence before physical commissioning.

> **Project status:** Active development. The application foundation, database connectivity, migrations, automated tests, and CI are established. The simulation and interactive engineering workbench are under development.

## The Problem

Modern critical-power installations integrate multiple subsystems, including generators, battery energy storage, switchgear, controls, and electrical loads.

These systems must behave predictably during utility outages, generator failures, switching problems, and changing load conditions.

Preparing and evaluating integration tests requires coordinating equipment configurations, operating sequences, customer requirements, and test evidence.

**GridProof explores how software can make preliminary integration testing more repeatable, explainable, and traceable.**

It is an independent engineering prototype, not a replacement for Cummins' existing testing infrastructure.

## Planned Core Features

- **Geographic Facility Explorer:** Map-based navigation featuring verified Cummins facility context, with a Fridley-inspired virtual integration lab.
- **Interactive Equipment Visualization:** A 2.5D power-system layout and focused 3D equipment inspection.
- **System Configuration:** Editable generator, battery, switchgear, and load parameters with immutable configuration history.
- **Deterministic Failure Simulation:** Reproducible utility outages, generator startup failures, breaker faults, battery depletion, and load disturbances.
- **Requirements-Based Validation:** Automated pass/fail assertions supported by timestamped simulation evidence.
- **Simulation Replay & Comparison:** Compare configurations and inspect the sequence of events behind test outcomes.
- **Engineering Reports:** Export PDF reports from saved simulation evidence.
- **AI-Assisted Test Authoring:** Optional Gemini integration that converts natural-language requests into structured test drafts requiring validation and user approval.

The core simulator is designed to function without AI API access.

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16, React 19, TypeScript |
| Styling | Tailwind CSS |
| Backend | Python 3.12, FastAPI |
| Database | PostgreSQL (Neon) |
| ORM & Migrations | SQLAlchemy 2, Alembic |
| Mapping (planned) | MapLibre GL JS |
| Visualization (planned) | React Three Fiber, 2.5D equipment assets |
| AI (planned) | Gemini API |
| Backend Testing | pytest, Ruff |
| Frontend Testing | Vitest, React Testing Library |
| Formatting | Prettier, Ruff |
| CI | GitHub Actions |
| Deployment (planned) | Vercel, Render, Neon |

## Architecture

The application uses a modular-monolith backend and API-first communication.

```text
Next.js Frontend
       |
       | REST API
       v
FastAPI Backend
       |
       +-- Configuration & Validation
       |
       +-- Simulation Engine (planned)
       |
       +-- Reporting (planned)
       |
       +-- Optional Gemini Integration (planned)
       |
       v
PostgreSQL (Neon)
```

The database stores configurations and their versions, scenario definitions, and eventually immutable simulation evidence.

The physical visualization, engineering diagram, and simulation results will use the same authoritative simulation state.

## Project Structure

```text
gridproof/
├── frontend/              # Next.js application
├── backend/
│   ├── app/
│   │   ├── core/          # Application settings
│   │   ├── db/            # SQLAlchemy models and sessions
│   │   └── main.py        # FastAPI entry point
│   ├── migrations/        # Alembic migration history
│   ├── tests/             # Backend tests
│   └── requirements.txt
├── assets/                # Future licensed equipment assets
├── docs/                  # Product and architecture specifications
├── tests/                 # Future cross-component tests
└── .github/workflows/     # GitHub Actions CI
```

## Local Development

### Prerequisites

- Node.js 24
- Python 3.12
- npm
- PostgreSQL database (Neon recommended)
- Git

### 1. Clone the Repository

```bash
git clone https://github.com/vhugo23/gridproof.git
cd gridproof
```

### 2. Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000.

### 3. Backend Setup

From the repository root:

```powershell
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

Copy `backend/.env.example` to `backend/.env` and configure:

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@HOST/gridproof?sslmode=require
```

Replace the placeholders with your own database credentials.

Start FastAPI:

```powershell
python -m uvicorn app.main:app --reload --port 8000
```

API documentation: http://localhost:8000/docs

### 4. Database Migrations

From `backend/` with the virtual environment activated:

```bash
python -m alembic upgrade head
python -m alembic current
```

Do not manually create the application tables; use Alembic migrations.

### 5. Verify Connectivity

Frontend-proxied API health check:

http://localhost:3000/api/v1/health

Backend health check:

http://localhost:8000/api/v1/health

Database health check:

http://localhost:8000/api/v1/health/database

A successful database response is:

```json
{
  "status": "connected",
  "database": "postgresql"
}
```

## Testing and Code Quality

### Frontend

Run from `frontend/`:

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build
npm audit --omit=dev
```

### Backend

Run from `backend/`:

```bash
python -m ruff format --check app tests
python -m ruff check app tests
python -m pytest -q
```

### Continuous Integration

GitHub Actions runs frontend and backend checks on pushes and pull requests targeting `main`.

The current CI installation uses `npm install` while cross-platform lockfile consistency is being resolved. Restoring `npm ci` is a planned tooling improvement.

## Implementation Progress

| Milestone | Status |
|---|---|
| Product requirements and architecture | Complete |
| Frontend and backend initialization | Complete |
| Frontend-to-backend API communication | Complete |
| Neon PostgreSQL connection | Complete |
| Database migrations 001 and 002 | Complete |
| Frontend and backend unit-test setup | Complete |
| GitHub Actions CI | Operational |
| Anonymous workspace sessions | Planned |
| Persistent configuration versioning API | Planned |
| Facility map and physical equipment UI | Planned |
| Deterministic simulation engine | Planned |
| Evidence reports and AI test drafting | Planned |

## Documentation

- [Product Requirements](docs/01-product-requirements.md)
- [User Flows & Acceptance Criteria](docs/02-user-flows-and-acceptance-criteria.md)
- [System Architecture](docs/03-system-architecture.md)
- [Database Design](docs/04-database-design.md)
- [API Contracts](docs/05-api-contracts.md)

## Security and Limitations

- Database credentials and API keys are never committed to Git.
- User inputs will be validated on the backend.
- Workspace data will be isolated through server-managed sessions.
- Historical simulation evidence will be preserved through immutable records.
- Operational datasets and equipment configurations are synthetic.
- The simulator will not provide certified electrical analyses or control real equipment.

## Disclaimer

GridProof is an independent student engineering project inspired by publicly available Cummins information.

It is not affiliated with, sponsored by, endorsed by, or operated by Cummins Inc.

Cummins product names and facility references belong to their respective owners. All simulated systems, performance data, and operating scenarios are illustrative unless explicitly sourced.
