from uuid import uuid4
from sqlalchemy import Column, Integer, String, ForeignKey, Text, DateTime
from datetime import datetime, timezone
from app.db.base import Base

class Analysis(Base):
    __tablename__ = "analyses"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id = Column(String(36), ForeignKey("users.id"))
    file_id = Column(String(36), ForeignKey("files.id"))

    analysis_type = Column(String(100))
    analysis_result = Column(Text)       # S3 key for the .npz pose file
    video_result = Column(Text, nullable=True)  # S3 key for the rendered video
    processing_time_seconds = Column(Integer)

    created_at = Column(DateTime, default=datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=datetime.now(timezone.utc))
