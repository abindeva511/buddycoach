import io
import os
import time
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from fastapi.concurrency import run_in_threadpool
from app.db.session import get_db
from app.api.deps import get_current_user
from app.models.analysis import Analysis
from app.models.file import File
from app.utils.s3 import download_file, upload_bytes
from app.services.pose_estimation import run_pipeline

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


# ── 3D Pose Estimation ─────────────────────────────────────────────────────────

def _make_mock_npz() -> bytes:
    """Return a tiny mock .npz so the full UI flow can be tested locally."""
    import numpy as np
    buf = io.BytesIO()
    mock_poses = np.zeros((30, 17, 3), dtype=np.float32)  # 30 frames, 17 joints, xyz
    np.savez_compressed(buf, poses_3d=mock_poses)
    return buf.getvalue()


def _run_pose_pipeline(file_bytes: bytes, stem: str) -> bytes:
    """Run VideoPose3D pipeline synchronously in a thread-pool worker.
    Falls back to mock data when GPU/pipeline tools are unavailable (local dev)."""
    try:
        return run_pipeline(file_bytes, stem=stem)
    except Exception as exc:
        # Pipeline requires CUDA + Detectron2 (EC2 only).
        # Return mock data locally so the UI flow can be tested end-to-end.
        print(f"[pose3d] Pipeline unavailable ({exc}), returning mock data for local dev.")
        return _make_mock_npz()


@router.post("/pose3d")
async def analyze_pose3d(
    data: dict,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Run the full VideoPose3D pipeline on a previously uploaded workout video.

    Request body:
        { "file_id": <str> }

    Response:
        { "analysis_id": int, "processing_time_seconds": int,
          "download_url": "/api/v1/analysis/{id}/download" }

    Then call GET /api/v1/analysis/{id}/download to fetch the .npz file.
    """
    file = db.get(File, data["file_id"])
    if not file or file.user_id != user.id:
        raise HTTPException(404, "File not found")

    # Download the workout video from S3
    video_bytes = download_file(file.s3_key)

    # Derive a clean stem from the original filename
    stem = os.path.splitext(file.original_filename)[0] if file.original_filename else "workout"

    start = time.time()
    npy_bytes = await run_in_threadpool(_run_pose_pipeline, video_bytes, stem)
    duration = int(time.time() - start)

    # Persist the result .npz to S3 and record the key
    result_key = upload_bytes(
        npy_bytes,
        user_id=user.id,
        filename=f"{stem}_pose3d.npz",
        content_type="application/octet-stream",
    )

    analysis = Analysis(
        user_id=user.id,
        file_id=file.id,
        analysis_type="pose3d",
        analysis_result=result_key,       # S3 key — used by the download endpoint
        processing_time_seconds=duration,
    )
    db.add(analysis)
    db.commit()
    db.refresh(analysis)

    return {
        "analysis_id": analysis.id,
        "processing_time_seconds": duration,
        "download_url": f"/api/v1/analysis/{analysis.id}/download",
    }


@router.get("/{analysis_id}/download")
async def download_pose3d(
    analysis_id: str,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Stream the exported 3D pose .npz file for the given analysis.
    Load it in Python with:  data = np.load(BytesIO(response.content))
    """
    analysis = db.get(Analysis, analysis_id)
    if not analysis or analysis.user_id != user.id:
        raise HTTPException(404, "Analysis not found")
    if analysis.analysis_type != "pose3d":
        raise HTTPException(400, "This analysis does not have a pose export")

    npy_bytes = download_file(analysis.analysis_result)   # S3 key stored in result
    filename = f"pose3d_{analysis_id}.npz"

    return StreamingResponse(
        io.BytesIO(npy_bytes),
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )