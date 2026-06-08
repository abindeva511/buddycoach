"""
2D Pose Estimation Service
===========================
Runs Detectron2 keypoint detection on a video and returns the raw
2D keypoints as a compressed numpy array (T, 17, 2) saved as .npz.

No VideoPose3D, no 3D lifting — Detectron2 output only.
"""

from __future__ import annotations

import io
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


def _parse_detectron_npz(out_dir: str, stem: str) -> np.ndarray:
    """
    Read the .npz file produced by infer_video_d2.py and return
    a (T, 17, 2) float32 array of (x, y) keypoints.

    infer_video_d2.py writes:  {out_dir}/{stem}.mp4.npz
    Structure:
      keypoints: object array of shape (T,), each element is
                 [[], kps] where kps is (N_persons, 4, 17)
                 channels 0,1 = x,y  channel 3 = confidence
    """
    npz_path = os.path.join(out_dir, f"{stem}.mp4.npz")
    if not os.path.exists(npz_path):
        # fallback: find any .npz in the output dir
        npzs = [f for f in os.listdir(out_dir) if f.endswith(".npz")]
        if not npzs:
            raise FileNotFoundError(f"No Detectron2 .npz found in {out_dir}")
        npz_path = os.path.join(out_dir, npzs[0])
        logger.warning("Using fallback npz: %s", npz_path)

    data = np.load(npz_path, allow_pickle=True)
    keypoints_raw = data["keypoints"]   # object array (T,), each = [[], kps_or_[]]

    frames: list[np.ndarray] = []
    for frame_entry in keypoints_raw:
        # frame_entry[1] is either [] (no detection) or (N_persons, 4, 17)
        kps_list = frame_entry[1]
        if not hasattr(kps_list, "__len__") or len(kps_list) == 0:
            kpts = frames[-1].copy() if frames else np.zeros((17, 2), dtype=np.float32)
        else:
            kps_arr = np.array(kps_list, dtype=np.float32)  # (N_persons, 4, 17)
            # Pick person with highest mean confidence (channel 3)
            scores = kps_arr[:, 3, :].mean(axis=1)          # (N_persons,)
            best = int(scores.argmax())
            kpts = kps_arr[best, :2, :].T                   # (17, 2)  x,y
        frames.append(kpts.astype(np.float32))

    return np.stack(frames, axis=0)   # (T, 17, 2)


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

        # Parse Detectron2 .npz → (T, 17, 2) numpy array
        kpts = _parse_detectron_npz(out_dir, stem)
        logger.info("2D pipeline complete — %d frames, shape %s", kpts.shape[0], kpts.shape)

        # Save as .npz
        buf = io.BytesIO()
        np.savez_compressed(buf, keypoints_2d=kpts)
        return buf.getvalue()
