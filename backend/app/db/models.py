
import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class DemoWorkspace(Base):
    __tablename__ = "demo_workspaces"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    token_hash: Mapped[str] = mapped_column(
        String(128),
        nullable=False,
        unique=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )

    __table_args__ = (
        CheckConstraint(
            "expires_at > created_at",
            name="ck_workspace_expiry",
        ),
        Index("ix_workspaces_expiry", "expires_at"),
    )


class FacilityCatalog(Base):
    __tablename__ = "facility_catalog"

    id: Mapped[str] = mapped_column(
        String(40),
        primary_key=True,
    )

    name: Mapped[str] = mapped_column(
        String(160),
        nullable=False,
    )

    city: Mapped[str] = mapped_column(
        String(120),
        nullable=False,
    )

    region: Mapped[str] = mapped_column(
        String(120),
        nullable=False,
    )

    country: Mapped[str] = mapped_column(
        String(120),
        nullable=False,
    )

    latitude: Mapped[float] = mapped_column(
        Numeric(9, 6, asdecimal=False),
        nullable=False,
    )

    longitude: Mapped[float] = mapped_column(
        Numeric(9, 6, asdecimal=False),
        nullable=False,
    )

    facility_type: Mapped[str] = mapped_column(
        String(80),
        nullable=False,
    )

    is_interactive: Mapped[bool] = mapped_column(
        Boolean,
        server_default="false",
        nullable=False,
    )

    description: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    source_url: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    source_note: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    catalog_version: Mapped[int] = mapped_column(
        Integer,
        server_default="1",
        nullable=False,
    )

    __table_args__ = (
        CheckConstraint(
            "latitude BETWEEN -90 AND 90",
            name="ck_facility_latitude",
        ),
        CheckConstraint(
            "longitude BETWEEN -180 AND 180",
            name="ck_facility_longitude",
        ),
        CheckConstraint(
            "catalog_version >= 1",
            name="ck_facility_catalog_version",
        ),
    )
