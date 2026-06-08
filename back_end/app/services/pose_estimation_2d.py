"""
2D Pose Estimation Service
===========================
Runs Detectron2 keypoint detection on a video and returns the raw
2D keypoints as a compressed numpy array (T, 17, 2) saved as .npz.

No VideoPose3D, no 3D lifting — Detectron2 output only.
"""

from __future__ import annotations

import io
import json
import logging
import os
import re
import shlex
import subprocess
import sys
import tempfile

import numpy as np

_PY = sys.executable
logger = logging.getLogger(__name__)

_WORK_ROOT     = os.environ.get("POSE_WORK_DIR", "/tmp/videopose3d")
_REPO_DIR      = os.path.join(_WORK_ROOT, "VideoPose3D")
_INFERENCE_DIR = os.path.join(_REPO_DIR, "inference")


def _run(cmd: str, cwd: str | None = None) -> None:
    logger.info(">>> %s", cmd)
    result = subprocess.run(
        cmd, shell=True, cwd=cwd,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    if result.stdout:
        logger.info("[stdout]\n%s", result.stdout[-4000:])
    if result.stderr:
        logger.warning("[stderr]\n%s", result.stderr[-4000:])
    if result.returncode != 0:
        raise RuntimeError(
            f"Pipeline step failed (exit {result.returncode}): {cmd}\n"
            f"--- stderr ---\n{(result.stderr or '')[-2000:]}"
        )


def _ensure_repo() -> None:
    if not os.path.exists(_REPO_DIR):
        os.makedirs(_WORK_ROOT, exist_ok=True)
        _run(f"git clone https://github.com/abindeva511/videopose3d.git {_REPO_DIR}")
    else:
        logger.info("[SKIP] VideoPose3D repo already present.")


def _parse_detectron_json(out_dir: str, stem: str) -> np.ndarray:
    """
    Read the JSON file produced by infer_video_d2.py and return
    a (T, 17, 2) float32 array of (x, y) keypoints.

    Detectron2's infer_video_d2.py writes one JSON per video named
    <stem>.mp4.json (or <stem>.json depending on version).
    Each entry is a list of person detections per frame; we pick
    the highest-confidence person per frame.
    """
    candidates = [
        os.path.join(out_dir, f"{stem}.mp4.json"),
        os.path.join(out_dir, f"{stem}.json"),
    ]
    json_path = next((p for p in candidates if os.path.exists(p)), None)
    if json_path is None:
        # Fallback: find any .json in the output dir
        jsons = [f for f in os.listdir(out_dir) if f.endswith(".json")]
        if not jsons:
            raise FileNotFoundError(f"No Detectron2 JSON found in {out_dir}")
        json_path = os.path.join(out_dir, jsons[0])
        logger.warning("Using fallback JSON: %s", json_path)

    with open(json_path) as f:
        data = json.load(f)

    # data is a list of frames; each frame is a list of detections.
    # Each detection: {"keypoints": [x, y, score, x, y, score, ...]}
    frames: list[np.ndarray] = []
    for frame_detections in data:
        if not frame_detections:
            # No person detected — repeat last frame or zeros
            kpts = frames[-1].copy() if frames else np.zeros((17, 2), dtype=np.float32)
        else:
            # Pick detection with highest mean keypoint score
            best = max(
                frame_detections,
                key=lambda d: np.array(d["keypoints"]).reshape(-1, 3)[:, 2].mean(),
            )
            raw = np.array(best["keypoints"], dtype=np.float32).reshape(17, 3)
            kpts = raw[:, :2]  # drop confidence column → (17, 2)
        frames.append(kpts)

    return np.stack(frames, axis=0)  # (T, 17, 2)


def run_pipeline_2d(video_bytes: bytes, stem: str = "input") -> bytes:
    """
    Run Detectron2 keypoint detection on *video_bytes*.

    Returns .npz bytes containing a (T, 17, 2) array of COCO keypoints
    (x, y) in pixel coordinates, stored under the key 'keypoints_2d'.
    """
    stem = re.sub(r'[^\w.-]', '_', stem)

    with tempfile.TemporaryDirectory(prefix="pose2d_") as job_dir:
        vid_dir = os.path.join(job_dir, "videos")
        out_dir = os.path.join(job_dir, "output")
        os.makedirs(vid_dir, exist_ok=True)
        os.makedirs(out_dir, exist_ok=True)

        # Write video
        input_video = os.path.join(vid_dir, f"{stem}.mp4")
        with open(input_video, "wb") as fh:
            fh.write(video_bytes)

        # Downsample to 15 fps, max 720p — same as 3D pipeline
        downsampled = os.path.join(vid_dir, f"{stem}_ds.mp4")
        _run(
            f"ffmpeg -y -i {shlex.quote(input_video)} "
            "-vf 'fps=15,scale=-2:min(ih\\,720)' "
            f"-c:v libx264 -crf 23 -preset fast -an {shlex.quote(downsampled)}"
        )
        os.replace(downsampled, input_video)

        # Ensure Detectron2 inference script is available
        _ensure_repo()

        # Run Detectron2 keypoint detection
        _run(
            f"{shlex.quote(_PY)} infer_video_d2.py "
            "--cfg COCO-Keypoints/keypoint_rcnn_R_101_FPN_3x.yaml "
            f"--output-dir {shlex.quote(out_dir)} "
            "--image-ext mp4 "
            f"{shlex.quote(vid_dir)}",
            cwd=_INFERENCE_DIR,
        )

        # Parse JSON → (T, 17, 2) numpy array
        kpts = _parse_detectron_json(out_dir, stem)
        logger.info("2D pipeline complete — %d frames, shape %s", kpts.shape[0], kpts.shape)

        # Save as .npz
        buf = io.BytesIO()
        np.savez_compressed(buf, keypoints_2d=kpts)
        return buf.getvalue()
