from fastapi import APIRouter, UploadFile, Depends, File as FastAPIFile, HTTPException
from sqlalchemy.orm import Session
from app.db.session import get_db, get_exercises_db
from app.api.deps import get_current_user
from app.models.file import File
from app.utils.s3 import upload_file, s3
from app.core.config import settings
from urllib.parse import unquote
import io

router = APIRouter(prefix="/files", tags=["files"])

@router.post("/from-exercise/{exercise_id}")
def register_exercise_video(exercise_id: int, user=Depends(get_current_user), db: Session = Depends(get_db), exercises_db: Session = Depends(get_exercises_db)):
    """Download an exercise reference video from S3 (server-side) and register it as an uploaded file."""
    from app.models.exercise import ExerciseDB
    exercise = exercises_db.query(ExerciseDB).filter(ExerciseDB.id == exercise_id).first()
    if not exercise:
        raise HTTPException(status_code=404, detail="Exercise not found")

    s3_url = exercise.video_url
    if not s3_url or not s3_url.strip():
        raise HTTPException(status_code=404, detail="No video URL for this exercise")

    # Parse bucket + key from S3 URL
    # e.g. https://buddy-coach-trainer.s3.us-east-1.amazonaws.com/exercises/Front_Raise.mp4
    try:
        clean_url = s3_url.split('?')[0]  # strip query params (URL may be a presigned URL)
        bucket = clean_url.split('//')[1].split('.s3.')[0]
        key = unquote(clean_url.split('.amazonaws.com/')[-1].strip('/'))
        obj = s3.get_object(Bucket=bucket, Key=key)
        video_bytes = obj['Body'].read()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch exercise video from S3: {e}")

    # Upload into the uploads bucket under the user's namespace
    filename = f"{exercise.exercise_name.replace(' ', '_')}_reference.mp4"
    new_key = upload_file(io.BytesIO(video_bytes), user.id, filename)

    db_file = File(
        user_id=user.id,
        original_filename=filename,
        s3_key=new_key,
        file_size=len(video_bytes)
    )
    db.add(db_file)
    db.commit()
    db.refresh(db_file)

    return {"id": db_file.id, "filename": db_file.original_filename}

@router.post("")
def upload(user=Depends(get_current_user), db: Session = Depends(get_db), file: UploadFile = FastAPIFile(...)):

    key = upload_file(file.file, user.id, file.filename)

    db_file = File(
        user_id=user.id,
        original_filename=file.filename,
        s3_key=key,
        file_size=file.size if file.size is not None else file.file.seek(0, 2)
    )

    db.add(db_file)
    db.commit()
    db.refresh(db_file)

    return {"id": db_file.id, "filename": db_file.original_filename}
