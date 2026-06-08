from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime
from app.db.base import Base


class MuscleGroupDB(Base):
    __tablename__ = "muscle_groups"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(Text, unique=True, nullable=False)
    url = Column(Text, nullable=True)
    
    exercises = relationship("ExerciseDB", back_populates="muscle_group")


class ExerciseDB(Base):
    __tablename__ = "exercises"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    muscle_group_id = Column(Integer, ForeignKey("muscle_groups.id"))
    muscle_name = Column(Text)
    equipment_type = Column(Text)
    exercise_name = Column(Text, nullable=False)
    exercise_url = Column(Text)
    video_url = Column(Text)
    video_path = Column(Text)
    downloaded = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    ref_npz_s3_key = Column(Text, nullable=True)   # cached 3D pose NPZ for the reference video

    muscle_group = relationship("MuscleGroupDB", back_populates="exercises")
