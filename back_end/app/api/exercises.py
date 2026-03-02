from fastapi import APIRouter, Depends, Query, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
from pydantic import BaseModel
import os
from app.db.session import get_exercises_db
from app.models.exercise import MuscleGroupDB, ExerciseDB

router = APIRouter(prefix="/exercises", tags=["exercises"])


# Pydantic models for response
class MuscleGroupResponse(BaseModel):
    id: int
    name: str
    exercise_count: int
    
    class Config:
        from_attributes = True


class ExerciseResponse(BaseModel):
    id: int
    muscle_group_id: Optional[int]
    muscle_name: Optional[str]
    equipment_type: Optional[str]
    exercise_name: str
    exercise_url: Optional[str]
    video_url: Optional[str]
    video_path: Optional[str]
    has_video: bool = False
    
    class Config:
        from_attributes = True


class ExerciseSearchResult(BaseModel):
    id: int
    exercise_name: str
    muscle_name: Optional[str]
    equipment_type: Optional[str]
    muscle_group_name: Optional[str]
    
    class Config:
        from_attributes = True


# Emoji mapping for muscle groups (anatomically relevant)
MUSCLE_GROUP_ICONS = {
    "Neck": "🧣",       # Neck/throat area
    "Shoulders": "🏋️",  # Weightlifter - deltoids
    "Chest": "🫀",      # Heart (in chest area) - pectorals
    "Back": "🏊",       # Swimmer - lats, back muscles
    "Arms": "💪",       # Flexed biceps - perfect
    "Thighs": "🦵",     # Leg - quadriceps/hamstrings
    "Calves": "🦶",     # Foot/ankle - calf muscles
    "Hips": "🧘",       # Yoga pose - hip flexors
    "Waist": "🎯",      # Target core - abs/obliques
    "Forearms": "🤜",   # Fist - forearm/grip strength
}


@router.get("/muscle-groups", response_model=List[dict])
def get_muscle_groups(db: Session = Depends(get_exercises_db)):
    """Get all muscle groups with exercise counts"""
    results = (
        db.query(
            MuscleGroupDB.id,
            MuscleGroupDB.name,
            func.count(ExerciseDB.id).label("exercise_count")
        )
        .outerjoin(ExerciseDB, MuscleGroupDB.id == ExerciseDB.muscle_group_id)
        .group_by(MuscleGroupDB.id, MuscleGroupDB.name)
        .order_by(MuscleGroupDB.name)
        .all()
    )
    
    return [
        {
            "id": r.id,
            "name": r.name,
            "icon": MUSCLE_GROUP_ICONS.get(r.name, "🏋️"),
            "exerciseCount": r.exercise_count,
        }
        for r in results
    ]


@router.get("/by-muscle/{muscle_group_id}", response_model=List[ExerciseResponse])
def get_exercises_by_muscle(
    muscle_group_id: int,
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_exercises_db)
):
    """Get exercises for a specific muscle group"""
    exercises = (
        db.query(ExerciseDB)
        .filter(ExerciseDB.muscle_group_id == muscle_group_id)
        .offset(skip)
        .limit(limit)
        .all()
    )
    # Add has_video flag based on video_path existence
    result = []
    for ex in exercises:
        ex_dict = {
            "id": ex.id,
            "muscle_group_id": ex.muscle_group_id,
            "muscle_name": ex.muscle_name,
            "equipment_type": ex.equipment_type,
            "exercise_name": ex.exercise_name,
            "exercise_url": ex.exercise_url,
            "video_url": ex.video_url,
            "video_path": ex.video_path,
            "has_video": bool(ex.video_path and ex.video_path.strip())
        }
        result.append(ex_dict)
    return result


@router.get("/search", response_model=List[ExerciseSearchResult])
def search_exercises(
    q: str = Query(..., min_length=1, description="Search query"),
    limit: int = Query(default=10, le=50),
    db: Session = Depends(get_exercises_db)
):
    """Search exercises by name (autocomplete)"""
    search_term = f"%{q.lower()}%"
    
    results = (
        db.query(
            ExerciseDB.id,
            ExerciseDB.exercise_name,
            ExerciseDB.muscle_name,
            ExerciseDB.equipment_type,
            MuscleGroupDB.name.label("muscle_group_name")
        )
        .outerjoin(MuscleGroupDB, ExerciseDB.muscle_group_id == MuscleGroupDB.id)
        .filter(func.lower(ExerciseDB.exercise_name).like(search_term))
        .distinct(ExerciseDB.exercise_name, ExerciseDB.muscle_name)
        .limit(limit)
        .all()
    )
    
    return [
        {
            "id": r.id,
            "exercise_name": r.exercise_name,
            "muscle_name": r.muscle_name,
            "equipment_type": r.equipment_type,
            "muscle_group_name": r.muscle_group_name,
        }
        for r in results
    ]


@router.get("/{exercise_id}", response_model=ExerciseResponse)
def get_exercise(exercise_id: int, db: Session = Depends(get_exercises_db)):
    """Get a specific exercise by ID"""
    exercise = db.query(ExerciseDB).filter(ExerciseDB.id == exercise_id).first()
    if not exercise:
        raise HTTPException(status_code=404, detail="Exercise not found")
    return {
        "id": exercise.id,
        "muscle_group_id": exercise.muscle_group_id,
        "muscle_name": exercise.muscle_name,
        "equipment_type": exercise.equipment_type,
        "exercise_name": exercise.exercise_name,
        "exercise_url": exercise.exercise_url,
        "video_url": exercise.video_url,
        "video_path": exercise.video_path,
        "has_video": bool(exercise.video_path and exercise.video_path.strip())
    }


@router.get("/{exercise_id}/video")
def get_exercise_video(exercise_id: int, db: Session = Depends(get_exercises_db)):
    """Stream exercise video file"""
    exercise = db.query(ExerciseDB).filter(ExerciseDB.id == exercise_id).first()
    if not exercise:
        raise HTTPException(status_code=404, detail="Exercise not found")
    
    if not exercise.video_path or not os.path.exists(exercise.video_path):
        raise HTTPException(status_code=404, detail="Video not found")
    
    return FileResponse(
        exercise.video_path,
        media_type="video/mp4",
        filename=f"{exercise.exercise_name}.mp4"
    )
