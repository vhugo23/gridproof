
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings

settings = get_settings()

database_url = settings.database_url.replace(
    "postgresql://",
    "postgresql+psycopg://",
    1,
)

engine = create_engine(
    database_url,
    pool_pre_ping=True,
    pool_size=3,
    max_overflow=2,
    pool_timeout=10,
    connect_args={"connect_timeout": 10},
)

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    expire_on_commit=False,
)


def get_db() -> Generator[Session, None, None]:
    with SessionLocal() as session:
        yield session
