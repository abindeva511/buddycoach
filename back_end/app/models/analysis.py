from sqlalchemy import Column, Integer, String, ForeignKey, Text, DateTime
from datetime import datetime, timezone
from app.db.base import Base

class Analysis(Base):
    __tablename__ = "analyses"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    file_id = Column(Integer, ForeignKey("files.id"))

    analysis_type = Column(String(100))
    analysis_result = Column(Text)
    processing_time_seconds = Column(Integer)

    created_at = Column(DateTime, default=datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=datetime.now(timezone.utc))