from fastapi import APIRouter, Depends, Query, HTTPException
from fastapi.responses import FileResponse, RedirectResponse
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
from pydantic import BaseModel
import os
import boto3
from botocore.exceptions import ClientError
from app.db.session import get_exercises_db
from app.models.exercise import MuscleGroupDB, ExerciseDB
from app.core.config import settings

router = APIRouter(prefix="/exercises", tags=["exercises"])

# Initialize S3 client for presigned URLs
def get_s3_client():
    """Get S3 client using AWS credentials from environment or .env"""
    try:
        # Try loading from environment
        access_key = os.environ.get('AWS_ACCESS_KEY_ID')
        secret_key = os.environ.get('AWS_SECRET_ACCESS_KEY')
        region = os.environ.get('AWS_REGION', 'us-east-1')
        
        # If credentials in env, use them directly
        if access_key and secret_key:
            return boto3.client(
                's3',
                region_name=region,
                aws_access_key_id=access_key,
                aws_secret_access_key=secret_key
            )
        
        # Otherwise try loading from .env via settings
        if hasattr(settings, 'AWS_ACCESS_KEY_ID'):
            return boto3.client(
                's3',
                region_name=settings.AWS_REGION or 'us-east-1',
                aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
                aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY
            )
        
        # Last resort: use default credentials (IAM role, ~/.aws/credentials, etc.)
        return boto3.client('s3', region_name='us-east-1')
    except Exception as e:
        print(f"Error creating S3 client: {e}")
        return None

def get_presigned_url(s3_url: str, expiry: int = 3600) -> Optional[str]:
    """
    Convert S3 URL to presigned URL for secure access.
    Presigned URLs are valid for 1 hour by default.
    """
    if not s3_url or not isinstance(s3_url, str):
        return None
    
    try:
        # Extract bucket and key from S3 URL
        # URL format: https://bucket-name.s3.us-east-1.amazonaws.com/key
        # or: https://bucket-name.s3.amazonaws.com/key
        if 's3' not in s3_url or 'amazonaws.com' not in s3_url:
            return s3_url  # Return as-is if not an S3 URL
        
        # Parse S3 URL: https://buddy-coach-trainer.s3.us-east-1.amazonaws.com/exercises/Front_Raise.mp4
        parts = s3_url.split('.')
        bucket = parts[0].replace('https://', '').strip()
        
        # Extract key from URL
        if '/exercises/' in s3_url:
            key = s3_url.split('.amazonaws.com/')[-1].strip('/')
        else:
            return s3_url
        
        s3_client = get_s3_client()
        if not s3_client:
            return s3_url  # Fallback to original URL
        
        presigned = s3_client.generate_presigned_url(
            'get_object',
            Params={'Bucket': bucket, 'Key': key},
            ExpiresIn=expiry
        )
        return presigned
    except Exception as e:
        print(f"Error processing S3 URL: {e}")
        return s3_url

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


@router.get("/by-muscle/{muscle_group_id}")
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
    # Add has_video flag and convert S3 URLs to presigned URLs
    result = []
    for ex in exercises:
        # Get presigned URL if video_url contains S3
        video_url = ex.video_url
        if video_url and isinstance(video_url, str) and 'amazonaws.com' in video_url:
            print(f"DEBUG: Converting URL for {ex.exercise_name}")
            presigned = get_presigned_url(video_url)
            print(f"DEBUG: Got presigned: {presigned[:80] if presigned else 'None'}...")
            if presigned and presigned != video_url:
                video_url = presigned
                print(f"DEBUG: Using presigned URL")
            else:
                print(f"DEBUG: Using original URL")
        
        ex_dict = {
            "id": ex.id,
            "muscle_group_id": ex.muscle_group_id,
            "muscle_name": ex.muscle_name,
            "equipment_type": ex.equipment_type,
            "exercise_name": ex.exercise_name,
            "exercise_url": ex.exercise_url,
            "video_url": video_url,
            "video_path": ex.video_path,
            "has_video": bool((ex.video_path and ex.video_path.strip()) or (ex.video_url and ex.video_url.strip()))
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
    
    # Get presigned URL if video_url contains S3
    video_url = exercise.video_url
    if video_url and isinstance(video_url, str) and 'amazonaws.com' in video_url:
        presigned = get_presigned_url(video_url)
        if presigned and presigned != video_url:
            video_url = presigned
    
    return {
        "id": exercise.id,
        "muscle_group_id": exercise.muscle_group_id,
        "muscle_name": exercise.muscle_name,
        "equipment_type": exercise.equipment_type,
        "exercise_name": exercise.exercise_name,
        "exercise_url": exercise.exercise_url,
        "video_url": video_url,
        "video_path": exercise.video_path,
        "has_video": bool((exercise.video_path and exercise.video_path.strip()) or (exercise.video_url and exercise.video_url.strip()))
    }


@router.get("/{exercise_id}/video")
def get_exercise_video(exercise_id: int, db: Session = Depends(get_exercises_db)):
    """Get or redirect to exercise video (returns presigned URL for S3)"""
    exercise = db.query(ExerciseDB).filter(ExerciseDB.id == exercise_id).first()
    if not exercise:
        raise HTTPException(status_code=404, detail="Exercise not found")
    
    # Prefer local file, fall back to presigned S3 URL
    if exercise.video_path and os.path.exists(exercise.video_path):
        return FileResponse(
            exercise.video_path,
            media_type="video/mp4",
            filename=f"{exercise.exercise_name}.mp4"
        )
    
    if exercise.video_url and exercise.video_url.strip():
        # If it's an S3 URL, generate presigned version
        if 's3.amazonaws.com' in exercise.video_url:
            presigned_url = get_presigned_url(exercise.video_url)
            if presigned_url:
                return RedirectResponse(url=presigned_url)
        # Otherwise redirect to original URL
        return RedirectResponse(url=exercise.video_url)
    
    raise HTTPException(status_code=404, detail="Video not found")


@router.get("/{exercise_id}/video-url")
def get_exercise_video_url(exercise_id: int, db: Session = Depends(get_exercises_db)):
    """Get presigned URL for exercise video (JSON response)"""
    exercise = db.query(ExerciseDB).filter(ExerciseDB.id == exercise_id).first()
    if not exercise:
        raise HTTPException(status_code=404, detail="Exercise not found")
    
    if not exercise.video_url and not exercise.video_path:
        raise HTTPException(status_code=404, detail="Video not found")
    
    # Return presigned URL for S3, or local path for filesystem
    video_url = exercise.video_url
    if video_url and 's3.amazonaws.com' in video_url:
        presigned = get_presigned_url(video_url)
        video_url = presigned or exercise.video_url
    
    return {
        "exercise_id": exercise_id,
        "exercise_name": exercise.exercise_name,
        "video_url": video_url,
        "video_path": exercise.video_path
    }
