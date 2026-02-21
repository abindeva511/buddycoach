import time
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from fastapi.concurrency import run_in_threadpool
from app.db.session import get_db
from app.api.deps import get_current_user
from app.models.analysis import Analysis
from app.models.file import File
from app.utils.s3 import download_file

router = APIRouter(prefix="/analysis", tags=["analysis"])

def run_analysis(file_bytes: bytes, analysis_type: str):
    time.sleep(60)  # simulate 1-minute processing
    return f"Analysis type: {analysis_type}\nFile size: {len(file_bytes)} bytes"

@router.post("")
async def analyze(data: dict, user=Depends(get_current_user), db: Session = Depends(get_db)):

    file = db.get(File, data["file_id"])
    if not file or file.user_id != user.id:
        raise HTTPException(404, "File not found")

    file_bytes = download_file(file.s3_key)

    start = time.time()
    result = await run_in_threadpool(run_analysis, file_bytes, data["analysis_type"])
    duration = int(time.time() - start)

    analysis = Analysis(
        user_id=user.id,
        file_id=file.id,
        analysis_type=data["analysis_type"],
        analysis_result=result,
        processing_time_seconds=duration
    )

    db.add(analysis)
    db.commit()
    db.refresh(analysis)

    return {
        "analysis_id": analysis.id,
        "processing_time_seconds": duration,
        "result": result
    }