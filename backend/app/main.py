from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.routes.configurations import router as configurations_router
from app.routes.daventry import router as daventry_router
from app.routes.demo import router as demo_router
from app.routes.facilities import router as facilities_router
from app.routes.mining import router as mining_router
from app.routes.mobile_power import router as mobile_power_router
from app.routes.session import router as session_router
from app.routes.seymour import router as seymour_router

app = FastAPI(
    title="GridProof API",
    description="Virtual Power Integration & Commissioning API",
    version="0.1.0",
)

app.include_router(configurations_router)
app.include_router(daventry_router)
app.include_router(demo_router)
app.include_router(facilities_router)
app.include_router(mining_router)
app.include_router(mobile_power_router)
app.include_router(seymour_router)
app.include_router(session_router)


@app.get("/api/v1/health")
def health_check():
    return {
        "status": "ok",
        "service": "gridproof-api",
    }


@app.get("/api/v1/health/database")
def database_health(
    db: Annotated[Session, Depends(get_db)],
):
    try:
        result = db.execute(text("SELECT 1")).scalar_one()

        if result != 1:
            raise HTTPException(
                status_code=503,
                detail="Database unavailable",
            )

        return {
            "status": "connected",
            "database": "postgresql",
        }

    except SQLAlchemyError:
        raise HTTPException(
            status_code=503,
            detail="Database unavailable",
        ) from None
