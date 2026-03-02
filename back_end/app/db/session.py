from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.core.config import settings
import os

engine = create_engine(settings.DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

# Exercises database (SQLite)
EXERCISES_DB_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))),
    "exercises.db"
)
exercises_engine = create_engine(f"sqlite:///{EXERCISES_DB_PATH}", connect_args={"check_same_thread": False})
ExercisesSessionLocal = sessionmaker(bind=exercises_engine, autoflush=False, autocommit=False)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def get_exercises_db():
    db = ExercisesSessionLocal()
    try:
        yield db
    finally:
        db.close()