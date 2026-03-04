import io
import os
import time
import json
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

def _make_mock_npz() -> dict:
    """Return mock data in the new dict format { "npz": bytes, "video": None }."""
    import numpy as np
    buf = io.BytesIO()
    mock_poses = np.zeros((30, 17, 3), dtype=np.float32)  # 30 frames, 17 joints, xyz
    np.savez_compressed(buf, poses_3d=mock_poses)
    return {
        "npz": buf.getvalue(),
        "video": None  # No video for mock data
    }


def _run_pose_pipeline(file_bytes: bytes, stem: str) -> dict:
    """Run VideoPose3D pipeline synchronously in a thread-pool worker.
    Falls back to mock data when GPU/pipeline tools are unavailable (local dev).
    
    Returns dict with {"npz": bytes, "video": bytes or None}
    """
    import logging
    logger = logging.getLogger(__name__)
    
    logger.info("🎥 ===== POSE ANALYSIS REQUEST RECEIVED =====")
    logger.info("📁 File stem: %s", stem)
    logger.info("📊 Video bytes size: %.2f MB", len(file_bytes) / 1024 / 1024)
    
    try:
        logger.info("⏳ Calling pose_estimation.run_pipeline()...")
        result = run_pipeline(file_bytes, stem=stem)
        logger.info("✅ Pipeline completed successfully")
        logger.info("📦 NPZ size: %.2f MB | Video available: %s", 
                   len(result.get("npz", b"")) / 1024 / 1024,
                   "Yes" if result.get("video") else "No")
        return result
    except Exception as exc:
        import traceback
        error_details = traceback.format_exc()
        
        # Log full error for debugging
        logger.error("\n❌ [POSE3D PIPELINE FAILED]")
        logger.error("Error type: %s", type(exc).__name__)
        logger.error("Error message: %s", exc)
        logger.error("Full traceback:\n%s", error_details)
        
        # On EC2 with CUDA, re-raise so user sees error instead of silent fallback
        import os
        if os.path.exists("/home/ubuntu"):  # EC2 marker
            logger.error("❌ Running on EC2 but pipeline failed - re-raising error")
            raise
        
        # Locally, return mock data for UI testing
        logger.warning("⚠️ Running locally - returning mock data for UI flow testing")
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
    import logging
    logger = logging.getLogger(__name__)
    
    logger.info("=== ANALYZE POSE3D ENDPOINT CALLED ===")
    logger.info("User ID: %s", user.id)
    logger.info("File ID: %s", data.get("file_id"))
    
    file = db.get(File, data["file_id"])
    if not file or file.user_id != user.id:
        logger.error("❌ File not found or unauthorized access")
        raise HTTPException(404, "File not found")

    logger.info("✅ File retrieved: %s (%.2f MB)", file.original_filename, len(file.s3_key)/1024 if file.s3_key else 0)

    # Download the workout video from S3
    logger.info("📥 Downloading video from S3...")
    video_bytes = download_file(file.s3_key)
    logger.info("✅ Downloaded: %.2f MB", len(video_bytes) / 1024 / 1024)

    # Derive a clean stem from the original filename
    stem = os.path.splitext(file.original_filename)[0] if file.original_filename else "workout"

    logger.info("⏳ Starting pose estimation pipeline...")
    start = time.time()
    pipeline_result = await run_in_threadpool(_run_pose_pipeline, video_bytes, stem)
    duration = int(time.time() - start)
    logger.info("✅ Pipeline complete in %d seconds", duration)

    # Extract pose data and rendered video from pipeline result
    npz_bytes = pipeline_result["npz"]
    video_bytes_rendered = pipeline_result["video"]

    # Persist the result .npz to S3 and record the key
    logger.info("📤 Uploading pose data to S3...")
    result_key = upload_bytes(
        npz_bytes,
        user_id=user.id,
        filename=f"{stem}_pose3d.npz",
        content_type="application/octet-stream",
    )
    logger.info("✅ Pose data uploaded: %s", result_key)

    # Upload rendered video if it was generated
    video_key = None
    if video_bytes_rendered:
        logger.info("📤 Uploading rendered video to S3...")
        video_key = upload_bytes(
            video_bytes_rendered,
            user_id=user.id,
            filename=f"{stem}_pose_visualization.mp4",
            content_type="video/mp4",
        )
        logger.info("✅ Rendered video uploaded: %s", video_key)
    else:
        logger.warning("⚠️ Rendered video was not generated")

    analysis = Analysis(
        user_id=user.id,
        file_id=file.id,
        analysis_type="pose3d",
        analysis_result=json.dumps({
            "pose_key": result_key,
            "video_key": video_key,
        }),
        processing_time_seconds=duration,
    )
    db.add(analysis)
    db.commit()
    db.refresh(analysis)

    logger.info("✅ Analysis saved to DB with ID: %s", analysis.id)
    logger.info("=== ANALYZE POSE3D ENDPOINT COMPLETE ===\n")

    response = {
        "analysis_id": analysis.id,
        "processing_time_seconds": duration,
        "pose_download_url": f"/api/v1/analysis/{analysis.id}/download?type=pose",
    }
    
    if video_key:
        response["video_download_url"] = f"/api/v1/analysis/{analysis.id}/download?type=video"
        response["video_available"] = True
    else:
        response["video_available"] = False

    return response


@router.get("/{analysis_id}/download")
async def download_pose3d(
    analysis_id: str,
    type: str = "pose",  # 'pose' or 'video'
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Download the exported 3D pose .npz file or rendered video for the given analysis.
    
    Query parameters:
        type: 'pose' (default) - Download pose data (.npz)
              'video' - Download rendered video with pose overlay (.mp4)
    
    Load pose data in Python with:  data = np.load(BytesIO(response.content))
    """
    analysis = db.get(Analysis, analysis_id)
    if not analysis or analysis.user_id != user.id:
        raise HTTPException(404, "Analysis not found")
    if analysis.analysis_type != "pose3d":
        raise HTTPException(400, "This analysis does not have a pose export")

    # Parse the result JSON to get both S3 keys
    result = json.loads(analysis.analysis_result)
    pose_key = result.get("pose_key")
    video_key = result.get("video_key")

    if type.lower() == "video":
        # Download rendered video
        if not video_key:
            raise HTTPException(404, "Rendered video not available for this analysis")
        
        video_bytes = download_file(video_key)
        filename = f"pose_visualization_{analysis_id}.mp4"
        
        return StreamingResponse(
            io.BytesIO(video_bytes),
            media_type="video/mp4",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    else:
        # Download pose data (default)
        if not pose_key:
            raise HTTPException(404, "Pose data not available for this analysis")
        
        npy_bytes = download_file(pose_key)
        filename = f"pose3d_{analysis_id}.npz"

        return StreamingResponse(
            io.BytesIO(npy_bytes),
            media_type="application/octet-stream",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )