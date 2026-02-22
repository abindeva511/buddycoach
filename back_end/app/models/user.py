from uuid import uuid4
from sqlalchemy import Column, String, Boolean, DateTime
from datetime import datetime, timezone
from app.db.base import Base

class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid4()))
    username = Column(String(50), unique=True, index=True)
    password_hash = Column(String(255))
    is_active = Column(Boolean, default=True)

    created_at = Column(DateTime, default=datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=datetime.now(timezone.utc))
