"""
VideoPose3D Pipeline Service
============================
Runs the full 3D pose estimation pipeline on a workout video and returns
the exported raw 3D pose data as bytes (.npz).

Requirements on the host machine
---------------------------------
  - ffmpeg
  - detectron2  (pip install 'git+https://github.com/facebookresearch/detectron2.git')
  - numpy, wget

The VideoPose3D repo is cloned automatically on first run into POSE_WORK_DIR
(default: /tmp/videopose3d).
"""

from __future__ import annotations

import logging
import os
import subprocess
import sys
import tempfile
import numpy as np

# Use the same Python interpreter that's running this code so subprocess
# calls inherit the correct conda / venv environment.
_PY = sys.executable

logger = logging.getLogger(__name__)

# ── Configurable paths (override via env vars) ─────────────────────────────────
_WORK_ROOT      = os.environ.get("POSE_WORK_DIR", "/tmp/videopose3d")
_REPO_DIR       = os.path.join(_WORK_ROOT, "VideoPose3D")
_INFERENCE_DIR  = os.path.join(_REPO_DIR, "inference")
_DATA_DIR       = os.path.join(_REPO_DIR, "data")
_CHECKPOINT_DIR = os.path.join(_REPO_DIR, "checkpoint")
_PRETRAINED     = "pretrained_h36m_detectron_coco.bin"
_PRETRAINED_URL = f"https://dl.fbaipublicfiles.com/video-pose-3d/{_PRETRAINED}"


def _run(cmd: str, cwd: str | None = None) -> str:
    """Run a shell command, stream output, raise on non-zero exit. Returns stdout."""
    logger.info(">>> %s", cmd)
    result = subprocess.run(cmd, shell=True, cwd=cwd, capture_output=True, text=True)
    
    # Log stderr and stdout
    if result.stdout:
        logger.info("STDOUT:\n%s", result.stdout[:2000])  # First 2000 chars
    if result.stderr:
        logger.info("STDERR:\n%s", result.stderr[:2000])  # First 2000 chars
    
    if result.returncode != 0:
        logger.error("Command failed with exit code %d", result.returncode)
        raise RuntimeError(
            f"Pipeline step failed (exit {result.returncode}): {cmd}"
        )
    return result.stdout


def _ensure_repo() -> None:
    """Clone VideoPose3D from your GitHub repo if not already present."""
    if not os.path.exists(_REPO_DIR):
        os.makedirs(_WORK_ROOT, exist_ok=True)
        logger.info("⏳ Cloning VideoPose3D from GitHub: https://github.com/abindeva511/videopose3d.git")
        _run(
            f"git clone https://github.com/abindeva511/videopose3d.git {_REPO_DIR}"
        )
        logger.info("✅ VideoPose3D cloned successfully")
    else:
        logger.info("[SKIP] VideoPose3D repo already present.")


def _ensure_pretrained() -> None:
    """Download the pretrained model checkpoint if not already present."""
    os.makedirs(_CHECKPOINT_DIR, exist_ok=True)
    dest = os.path.join(_CHECKPOINT_DIR, _PRETRAINED)
    if not os.path.exists(dest):
        _run(f"wget -q {_PRETRAINED_URL} -O {dest}")
    else:
        logger.info("[SKIP] Pretrained model already downloaded.")


def run_pipeline(video_bytes: bytes, stem: str = "input") -> dict:
    """
    Execute the full VideoPose3D pipeline on *video_bytes*.

    Parameters
    ----------
    video_bytes : raw video file content (must be an mp4 / ffmpeg-compatible format)
    stem        : base name used for temp files and the export filename

    Returns
    -------
    dict : { "npz": bytes, "video": bytes or None }
           - "npz": content of the exported ``<stem>.npz`` (or .npy) file with pose data
           - "video": rendered video with pose overlay (mp4) or None if not generated
    """
    logger.info("🎬 ========== POSE ESTIMATION PIPELINE STARTED ==========")
    logger.info("📦 Video size: %.2f MB", len(video_bytes) / 1024 / 1024)
    
    with tempfile.TemporaryDirectory(prefix="pose_") as job_dir:
        vid_dir = os.path.join(job_dir, "videos")
        out_dir = os.path.join(job_dir, "output_directory")
        os.makedirs(vid_dir, exist_ok=True)
        os.makedirs(out_dir, exist_ok=True)
        logger.info("📁 Working directory: %s", job_dir)

        # Write the uploaded video to a temp mp4 file
        input_video = os.path.join(vid_dir, f"{stem}.mp4")
        with open(input_video, "wb") as fh:
            fh.write(video_bytes)
        logger.info("✅ Step 1: Video saved to %s", input_video)

        # Ensure repo + pretrained model are ready
        logger.info("⏳ Step 2a: Checking VideoPose3D repo...")
        _ensure_repo()
        logger.info("✅ Step 2a: VideoPose3D repo ready")
        
        logger.info("⏳ Step 2b: Checking pretrained model...")
        _ensure_pretrained()
        logger.info("✅ Step 2b: Pretrained model ready")

        # Step 2: 2D keypoint detection with Detectron2
        logger.info("⏳ Step 3: Running 2D keypoint detection (Detectron2)...")
        _run(
            f"{_PY} infer_video_d2.py "
            "--cfg COCO-Keypoints/keypoint_rcnn_R_101_FPN_3x.yaml "
            f"--output-dir {out_dir} "
            "--image-ext mp4 "
            f"{vid_dir}",
            cwd=_INFERENCE_DIR,
        )
        logger.info("✅ Step 3: 2D keypoints extracted (format: .npy with pickle)")

        # Step 3: prepare custom 2D dataset
        logger.info("⏳ Step 4: Preparing 2D custom dataset...")
        _run(
            f"{_PY} prepare_data_2d_custom.py -i {out_dir} -o myvideos",
            cwd=_DATA_DIR,
        )
        logger.info("✅ Step 4: 2D dataset prepared")

        # Step 4: export raw 3D pose data
        logger.info("⏳ Step 5: Lifting 2D pose to 3D (this uses the pretrained model)...")
        export_base = os.path.join(job_dir, stem)
        
        # Use --viz-size 4 for smaller skeleton visualization to prevent cropping
        # The original video dimensions are preserved when using --viz-video
        _run(
            f"{_PY} run.py "
            "-d custom -k myvideos "
            "-arc 3,3,3,3,3 "
            f"-c checkpoint --evaluate {_PRETRAINED} "
            "--render "
            f"--viz-subject {stem}.mp4 "
            "--viz-action custom "
            "--viz-camera 0 "
            f"--viz-video {input_video} "
            f"--viz-export {export_base} "
            "--viz-size 4",
            cwd=_REPO_DIR,
        )
        logger.info("✅ Step 5: 3D pose lift complete")

        # Locate result file (.npz or .npy) - pose data
        logger.info("⏳ Step 6: Finalizing results...")
        result_path = f"{export_base}.npz"
        if not os.path.exists(result_path):
            result_path = f"{export_base}.npy"

        if not os.path.exists(result_path):
            raise FileNotFoundError(
                f"Pipeline finished but export not found at {export_base}.[npz|npy]"
            )

        logger.info("✅ Step 6: Pose data file found: %s", result_path)
        npz_size = os.path.getsize(result_path)
        logger.info("📊 Pose data size: %.2f MB", npz_size / 1024 / 1024)
        
        with open(result_path, "rb") as fh:
            npz_bytes = fh.read()
        
        # Locate rendered video file (.mp4) - visualization
        logger.info("⏳ Step 7: Looking for rendered video...")
        
        # Debug: List ALL files created to understand what the pipeline generates
        logger.info("📂 === FILES IN JOB DIRECTORY ===")
        for root, dirs, files in os.walk(job_dir):
            for f in files:
                full_path = os.path.join(root, f)
                rel_path = os.path.relpath(full_path, job_dir)
                try:
                    size = os.path.getsize(full_path)
                    logger.info("  - %s (%.3f MB)", rel_path, size / 1024 / 1024)
                except:
                    logger.info("  - %s (size unknown)", rel_path)
        
        # Also check REPO_DIR for any viz outputs
        logger.info("📂 === FILES IN REPO DIRECTORY (may contain viz results) ===")
        for root, dirs, files in os.walk(_REPO_DIR):
            # Skip large dirs like .git, __pycache__
            dirs[:] = [d for d in dirs if not d.startswith('.') and d != '__pycache__']
            for f in files:
                if 'viz' in f.lower() or f.endswith(('.mp4', '.avi', '.mov')):
                    full_path = os.path.join(root, f)
                    rel_path = os.path.relpath(full_path, _REPO_DIR)
                    try:
                        size = os.path.getsize(full_path)
                        logger.info("  - %s (%.3f MB)", rel_path, size / 1024 / 1024)
                    except:
                        logger.info("  - %s (size unknown)", rel_path)
        
        video_bytes = None
        
        # Try multiple possible locations for the rendered video
        possible_paths = [
            f"{export_base}.mp4",
            f"{export_base}_viz.mp4",
            os.path.join(job_dir, f"{stem}.mp4"),
            os.path.join(out_dir, f"{stem}.mp4"),
            os.path.join(_REPO_DIR, "results", f"{stem}.mp4"),
            os.path.join(_REPO_DIR, "outputs", f"{stem}.mp4"),
            # Also check with .avi extension
            f"{export_base}.avi",
            f"{export_base}_viz.avi",
        ]
        
        video_path = None
        for path in possible_paths:
            if os.path.exists(path):
                video_path = path
                logger.info("✅ Step 7: Rendered video found: %s", video_path)
                video_size = os.path.getsize(video_path)
                logger.info("🎬 Video size: %.2f MB", video_size / 1024 / 1024)
                with open(video_path, "rb") as fh:
                    video_bytes = fh.read()
                break
        
        if not video_path:
            logger.warning("⚠️ Step 7: Rendered video not found at common paths (optional)")
        
        logger.info("🎉 ========== POSE ESTIMATION PIPELINE COMPLETE ==========")
        return {"npz": npz_bytes, "video": video_bytes}
