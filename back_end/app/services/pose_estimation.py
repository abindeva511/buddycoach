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
import re
import shlex
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


def _run(cmd: str, cwd: str | None = None) -> None:
    """Run a shell command, stream stdout/stderr to logger, raise on non-zero exit."""
    logger.info(">>> %s", cmd)
    result = subprocess.run(
        cmd, shell=True, cwd=cwd,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
    )
    if result.stdout:
        logger.info("[stdout]\n%s", result.stdout[-4000:])
    if result.stderr:
        logger.warning("[stderr]\n%s", result.stderr[-4000:])
    if result.returncode != 0:
        stderr_snippet = (result.stderr or "")[-2000:]
        raise RuntimeError(
            f"Pipeline step failed (exit {result.returncode}): {cmd}\n"
            f"--- stderr ---\n{stderr_snippet}"
        )


def _ensure_repo() -> None:
    """Clone VideoPose3D if not already present."""
    if not os.path.exists(_REPO_DIR):
        os.makedirs(_WORK_ROOT, exist_ok=True)
        _run(
            f"git clone https://github.com/abindeva511/videopose3d.git {_REPO_DIR}"
        )
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


def run_pipeline(video_bytes: bytes, stem: str = "input") -> tuple[bytes, bytes | None]:
    """
    Execute the full VideoPose3D pipeline on *video_bytes*.

    Parameters
    ----------
    video_bytes : raw video file content (must be an mp4 / ffmpeg-compatible format)
    stem        : base name used for temp files and the export filename

    Returns
    -------
    tuple:
        npz_bytes  : content of the exported 3D pose ``.npz`` (or ``.npy``) file
        video_bytes: content of the rendered pose overlay video (.mp4), or None
    """
    # Sanitize stem: replace whitespace and shell-unsafe chars with underscores
    stem = re.sub(r'[^\w.-]', '_', stem)

    with tempfile.TemporaryDirectory(prefix="pose_") as job_dir:
        vid_dir = os.path.join(job_dir, "videos")
        out_dir = os.path.join(job_dir, "output_directory")
        os.makedirs(vid_dir, exist_ok=True)
        os.makedirs(out_dir, exist_ok=True)

        # Write the uploaded video to a temp mp4 file
        input_video = os.path.join(vid_dir, f"{stem}.mp4")
        with open(input_video, "wb") as fh:
            fh.write(video_bytes)

        # Ensure repo + pretrained model are ready
        _ensure_repo()
        _ensure_pretrained()

        # Step 2: 2D keypoint detection with Detectron2
        _run(
            f"{shlex.quote(_PY)} infer_video_d2.py "
            "--cfg COCO-Keypoints/keypoint_rcnn_R_101_FPN_3x.yaml "
            f"--output-dir {shlex.quote(out_dir)} "
            "--image-ext mp4 "
            f"{shlex.quote(vid_dir)}",
            cwd=_INFERENCE_DIR,
        )

        # Step 3: prepare custom 2D dataset
        _run(
            f"{shlex.quote(_PY)} prepare_data_2d_custom.py -i {shlex.quote(out_dir)} -o myvideos",
            cwd=_DATA_DIR,
        )

        # Step 4: export raw 3D pose data (.npz) + rendered video
        export_base = os.path.join(job_dir, stem)
        output_video = f"{export_base}_rendered.mp4"
        _run(
            f"{shlex.quote(_PY)} run.py "
            "-d custom -k myvideos "
            "-arc 3,3,3,3,3 "
            f"-c checkpoint --evaluate {shlex.quote(_PRETRAINED)} "
            "--render "
            f"--viz-subject {shlex.quote(stem + '.mp4')} "
            "--viz-action custom "
            "--viz-camera 0 "
            f"--viz-video {shlex.quote(input_video)} "
            f"--viz-export {shlex.quote(export_base)} "
            f"--viz-output {shlex.quote(output_video)} "
            "--viz-size 6",
            cwd=_REPO_DIR,
        )

        # VideoPose3D appends .npz; some builds use .npy
        result_path = f"{export_base}.npz"
        if not os.path.exists(result_path):
            result_path = f"{export_base}.npy"

        if not os.path.exists(result_path):
            raise FileNotFoundError(
                f"Pipeline finished but export not found at {export_base}.[npz|npy]"
            )

        logger.info("Pipeline complete — reading pose: %s", result_path)
        with open(result_path, "rb") as fh:
            npz_bytes = fh.read()

        video_bytes_out: bytes | None = None
        if os.path.exists(output_video):
            logger.info("Pipeline complete — reading video: %s", output_video)
            with open(output_video, "rb") as fh:
                video_bytes_out = fh.read()
        else:
            logger.warning("Rendered video not found at %s — skipping", output_video)

        return npz_bytes, video_bytes_out
