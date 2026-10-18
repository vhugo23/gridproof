from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db.session import get_db

app = FastAPI(
    title="GridProof API",
    description="Virtual Power Integration & Commissioning API",
    version="0.1.0",
)


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
