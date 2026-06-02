import io
import os
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
from app.services.comparison import run_comparison
from app.core.config import settings

router = APIRouter(prefix="/analysis", tags=["analysis"])

# ── 3D Pose Estimation ─────────────────────────────────────────────────────────

def _make_mock_npz() -> bytes:
    """Return a tiny mock .npz so the full UI flow can be tested locally."""
    import numpy as np
    buf = io.BytesIO()
    mock_poses = np.zeros((30, 17, 3), dtype=np.float32)  # 30 frames, 17 joints, xyz
    np.savez_compressed(buf, poses_3d=mock_poses)
    return buf.getvalue()


def _run_pose_pipeline(file_bytes: bytes, stem: str) -> tuple[bytes, bytes | None]:
    """Run VideoPose3D pipeline synchronously in a thread-pool worker.
    Returns (npz_bytes, video_bytes_or_None).
    Falls back to mock data when GPU/pipeline tools are unavailable (local dev)."""
    try:
        return run_pipeline(file_bytes, stem=stem)
    except Exception as exc:
        import traceback
        error_details = traceback.format_exc()

        # Log full error for debugging
        print(f"\n[pose3d] Pipeline failed:")
        print(f"[pose3d] Error type: {type(exc).__name__}")
        print(f"[pose3d] Error message: {exc}")
        print(f"[pose3d] Full traceback:\n{error_details}")

        # On EC2, re-raise so user sees error instead of silent fallback
        import os
        if os.path.exists("/home/ubuntu"):  # EC2 marker
            print("[pose3d] ❌ Running on EC2 but pipeline failed - re-raising error")
            raise

        # Locally, return mock data for UI testing
        print("[pose3d] Running locally - returning mock data for UI flow testing")
        return _make_mock_npz(), None


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
    npy_bytes, rendered_video_bytes = await run_in_threadpool(_run_pose_pipeline, video_bytes, stem)
    duration = int(time.time() - start)

    # Persist the result .npz to S3
    result_key = upload_bytes(
        npy_bytes,
        user_id=user.id,
        filename=f"{stem}_pose3d.npz",
        content_type="application/octet-stream",
    )

    # Persist the rendered video to S3 (if produced)
    video_key = None
    if rendered_video_bytes:
        video_key = upload_bytes(
            rendered_video_bytes,
            user_id=user.id,
            filename=f"{stem}_pose3d_render.mp4",
            content_type="video/mp4",
        )

    analysis = Analysis(
        user_id=user.id,
        file_id=file.id,
        analysis_type="pose3d",
        analysis_result=result_key,
        video_result=video_key,
        processing_time_seconds=duration,
    )
    db.add(analysis)
    db.commit()
    db.refresh(analysis)

    return {
        "analysis_id": analysis.id,
        "processing_time_seconds": duration,
        "download_url": f"/api/v1/analysis/{analysis.id}/download",
        "video_available": video_key is not None,
        "video_download_url": f"/api/v1/analysis/{analysis.id}/video" if video_key else None,
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


@router.get("/{analysis_id}/video")
async def download_pose3d_video(
    analysis_id: str,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Stream the rendered pose overlay video (.mp4) for the given analysis.
    """
    analysis = db.get(Analysis, analysis_id)
    if not analysis or analysis.user_id != user.id:
        raise HTTPException(404, "Analysis not found")
    if not analysis.video_result:
        raise HTTPException(404, "No rendered video available for this analysis")

    video_bytes = download_file(analysis.video_result)
    filename = f"pose3d_render_{analysis_id}.mp4"

    return StreamingResponse(
        io.BytesIO(video_bytes),
        media_type="video/mp4",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/compare")
async def compare_poses(
    data: dict,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Run DTW alignment + joint angle analysis + GPT spine coaching on two
    previously completed pose3d analyses.

    Request body:
        { "user_analysis_id": "<str>", "ref_analysis_id": "<str>" }

    Response:
        {
            "dtw_cost": float,
            "n_matched_frames": int,
            "frames": [
                {
                    "idx": 0,
                    "user_frame_no": int,
                    "ref_frame_no": int,
                    "user_image": "data:image/jpeg;base64,...",
                    "ref_image":  "data:image/jpeg;base64,...",
                    "right_knee_you": float, "right_knee_ref": float,
                    "left_knee_you":  float, "left_knee_ref":  float,
                    "right_hip_you":  float, "right_hip_ref":  float,
                    "left_hip_you":   float, "left_hip_ref":   float,
                    "spine_coaching": str
                },
                ...
            ]
        }
    """
    user_analysis_id = data.get("user_analysis_id")
    ref_analysis_id  = data.get("ref_analysis_id")

    if not user_analysis_id or not ref_analysis_id:
        raise HTTPException(400, "user_analysis_id and ref_analysis_id are required")

    user_analysis = db.get(Analysis, user_analysis_id)
    ref_analysis  = db.get(Analysis, ref_analysis_id)

    if not user_analysis or user_analysis.user_id != user.id:
        raise HTTPException(404, "User analysis not found")
    if not ref_analysis:
        raise HTTPException(404, "Reference analysis not found")

    # Fetch NPZ bytes (analysis_result stores the S3 key for the .npz)
    user_npz_bytes = download_file(user_analysis.analysis_result)
    ref_npz_bytes  = download_file(ref_analysis.analysis_result)

    # Fetch original video bytes from the linked File records
    user_file = db.get(File, user_analysis.file_id)
    ref_file  = db.get(File, ref_analysis.file_id)

    if not user_file or not ref_file:
        raise HTTPException(500, "Could not locate original video files")

    user_video_bytes = download_file(user_file.s3_key)
    ref_video_bytes  = download_file(ref_file.s3_key)

    openai_key = settings.OPENAI_API_KEY

    result = await run_in_threadpool(
        run_comparison,
        user_npz_bytes,
        ref_npz_bytes,
        user_video_bytes,
        ref_video_bytes,
        openai_key,
    )
    return result