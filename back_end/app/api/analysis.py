import io
import os
import time
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from fastapi.concurrency import run_in_threadpool
from app.db.session import get_db, get_exercises_db
from app.api.deps import get_current_user
from app.models.analysis import Analysis
from app.models.file import File
from app.utils.s3 import download_file, upload_bytes
from app.services.pose_estimation import run_pipeline
from app.services.pose_estimation_2d import run_pipeline_2d
from app.services.comparison import run_comparison
from app.services.comparison_2d import run_comparison_2d
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


def _run_pose_pipeline(file_bytes: bytes, stem: str, render: bool = True) -> tuple[bytes, bytes | None]:
    """Run VideoPose3D pipeline synchronously in a thread-pool worker.
    Returns (npz_bytes, video_bytes_or_None).
    Falls back to mock data when GPU/pipeline tools are unavailable (local dev)."""
    try:
        return run_pipeline(file_bytes, stem=stem, render=render)
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
    npy_bytes, rendered_video_bytes = await run_in_threadpool(_run_pose_pipeline, video_bytes, stem, True)
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
    exercises_db: Session = Depends(get_exercises_db),
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


@router.post("/pose3d-ref/{exercise_id}")
async def analyze_pose3d_reference(
    exercise_id: int,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
    exercises_db: Session = Depends(get_exercises_db),
):
    """
    Run pose3d on a reference exercise video, with NPZ caching.
    If the exercise NPZ was already computed, return it instantly.
    Otherwise run the pipeline, store the NPZ key on the exercise record, and return.
    """
    from app.models.exercise import ExerciseDB
    from app.utils.s3 import upload_bytes, download_file, s3
    from urllib.parse import unquote

    exercise = exercises_db.query(ExerciseDB).filter(ExerciseDB.id == exercise_id).first()
    if not exercise:
        raise HTTPException(404, "Exercise not found")
    if not exercise.video_url:
        raise HTTPException(404, "No reference video for this exercise")

    # ── Cache hit: NPZ already computed for this exercise ────────────────────────
    if exercise.ref_npz_s3_key:
        # Find or create a synthetic Analysis row so the compare endpoint works
        cached = db.query(Analysis).filter(
            Analysis.analysis_type == "pose3d_ref",
            Analysis.analysis_result == exercise.ref_npz_s3_key,
        ).first()
        if cached:
            return {
                "analysis_id": cached.id,
                "processing_time_seconds": cached.processing_time_seconds,
                "cached": True,
                "download_url": f"/api/v1/analysis/{cached.id}/download",
                "video_available": False,
            }

    # ── Cache miss: fetch video from S3, run pipeline (no render), cache result ───
    try:
        bucket = exercise.video_url.split('//')[1].split('.s3.')[0]
        key = unquote(exercise.video_url.split('.amazonaws.com/')[-1].strip('/'))
        obj = s3.get_object(Bucket=bucket, Key=key)
        video_bytes = obj['Body'].read()
    except Exception as e:
        raise HTTPException(502, f"Failed to fetch reference video: {e}")

    stem = exercise.exercise_name.replace(' ', '_').replace('/', '_')
    start = time.time()
    # render=False: skip skeleton video rendering for reference — not needed
    npz_bytes, _ = await run_in_threadpool(_run_pose_pipeline, video_bytes, stem, False)
    duration = int(time.time() - start)

    # Store NPZ in S3
    npz_key = upload_bytes(
        npz_bytes,
        user_id="ref",
        filename=f"ref_{exercise_id}_{stem}_pose3d.npz",
        content_type="application/octet-stream",
    )

    # Cache the key on the exercise row so future calls skip the pipeline
    exercise.ref_npz_s3_key = npz_key
    exercises_db.commit()

    # Create an Analysis record (no file_id since this is a reference, not a user upload)
    analysis = Analysis(
        user_id=user.id,
        file_id=None,
        analysis_type="pose3d_ref",
        analysis_result=npz_key,
        video_result=None,
        processing_time_seconds=duration,
    )
    db.add(analysis)
    db.commit()
    db.refresh(analysis)

    return {
        "analysis_id": analysis.id,
        "processing_time_seconds": duration,
        "cached": False,
        "download_url": f"/api/v1/analysis/{analysis.id}/download",
        "video_available": False,
    }


# ── 2D Pose Estimation ─────────────────────────────────────────────────────────

@router.post("/pose2d")
async def analyze_pose2d(
    data: dict,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Run Detectron2 2D keypoint detection on a previously uploaded video.
    Skips VideoPose3D entirely — returns (T, 17, 2) COCO keypoints as .npz.

    Request body:  { "file_id": "<str>" }
    Response:      { "analysis_id", "processing_time_seconds", "download_url" }
    """
    file = db.get(File, data["file_id"])
    if not file or file.user_id != user.id:
        raise HTTPException(404, "File not found")

    video_bytes = download_file(file.s3_key)
    stem = os.path.splitext(file.original_filename)[0] if file.original_filename else "workout"

    start = time.time()

    def _run_2d(vb: bytes, s: str) -> bytes:
        try:
            return run_pipeline_2d(vb, stem=s)
        except Exception as exc:
            import traceback, os as _os
            print(f"\n[pose2d] Pipeline failed: {exc}\n{traceback.format_exc()}")
            if _os.path.exists("/home/ubuntu"):
                raise
            # Local fallback: mock (30, 17, 2) zeros
            import numpy as np, io as _io
            buf = _io.BytesIO()
            np.savez_compressed(buf, keypoints_2d=np.zeros((30, 17, 2), dtype=np.float32))
            return buf.getvalue()

    npz_bytes = await run_in_threadpool(_run_2d, video_bytes, stem)
    duration = int(time.time() - start)

    result_key = upload_bytes(
        npz_bytes,
        user_id=user.id,
        filename=f"{stem}_pose2d.npz",
        content_type="application/octet-stream",
    )

    analysis = Analysis(
        user_id=user.id,
        file_id=file.id,
        analysis_type="pose2d",
        analysis_result=result_key,
        video_result=None,
        processing_time_seconds=duration,
    )
    db.add(analysis)
    db.commit()
    db.refresh(analysis)

    return {
        "analysis_id": analysis.id,
        "processing_time_seconds": duration,
        "download_url": f"/api/v1/analysis/{analysis.id}/download",
        "video_available": False,
        "video_download_url": None,
    }


@router.post("/compare2d")
async def compare_poses_2d(
    data: dict,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Run 2D DTW alignment + joint angle analysis + GPT spine coaching.
    Same request/response shape as /compare so the frontend needs no changes.

    Request body:  { "user_analysis_id": "<str>", "ref_analysis_id": "<str>" }
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

    user_npz_bytes = download_file(user_analysis.analysis_result)
    ref_npz_bytes  = download_file(ref_analysis.analysis_result)

    user_file = db.get(File, user_analysis.file_id)
    ref_file  = db.get(File, ref_analysis.file_id) if ref_analysis.file_id else None

    if not user_file:
        raise HTTPException(500, "Could not locate user video file")

    user_video_bytes = download_file(user_file.s3_key)
    ref_video_bytes  = download_file(ref_file.s3_key) if ref_file else user_video_bytes

    result = await run_in_threadpool(
        run_comparison_2d,
        user_npz_bytes,
        ref_npz_bytes,
        user_video_bytes,
        ref_video_bytes,
        settings.OPENAI_API_KEY,
    )
    return result