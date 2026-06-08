"""
2D Pose Estimation Service
===========================
Runs Detectron2 keypoint detection on a video and returns the raw
2D keypoints as a compressed numpy array (T, 17, 2) saved as .npz.

The Detectron2 predictor is loaded ONCE as a module-level singleton and
kept in memory for the lifetime of the uvicorn process.  After the first
request (~20s warm-up) every subsequent request only pays inference cost
(~50-100 ms/frame on GPU, ~200-400 ms/frame on CPU).

No VideoPose3D, no 3D lifting — Detectron2 output only.
"""

from __future__ import annotations

import io
import logging
import os
import re
import subprocess
import sys
import tempfile

import numpy as np

logger = logging.getLogger(__name__)

_WORK_ROOT = os.environ.get("POSE_WORK_DIR", "/tmp/videopose3d")
_REPO_DIR  = os.path.join(_WORK_ROOT, "VideoPose3D")

# ── Singleton predictor ───────────────────────────────────────────────────────
# Loaded once on first call; subsequent calls reuse the already-loaded model.
_PREDICTOR = None


def _get_predictor():
    global _PREDICTOR
    if _PREDICTOR is not None:
        return _PREDICTOR

    logger.info("[pose2d] Loading Detectron2 model (one-time warm-up)...")
    try:
        import detectron2
        from detectron2.config import get_cfg
        from detectron2 import model_zoo
        from detectron2.engine import DefaultPredictor

        # Add inference dir to path so model_zoo can resolve relative config paths
        inf_dir = os.path.join(_REPO_DIR, "inference")
        if inf_dir not in sys.path:
            sys.path.insert(0, inf_dir)

        cfg = get_cfg()
        # R-50 is ~40% faster than R-101 with negligible accuracy loss for pose
        cfg.merge_from_file(model_zoo.get_config_file(
            "COCO-Keypoints/keypoint_rcnn_R_50_FPN_3x.yaml"
        ))
        cfg.MODEL.ROI_HEADS.SCORE_THRESH_TEST = 0.7
        cfg.MODEL.WEIGHTS = model_zoo.get_checkpoint_url(
            "COCO-Keypoints/keypoint_rcnn_R_50_FPN_3x.yaml"
        )
        _PREDICTOR = DefaultPredictor(cfg)
        logger.info("[pose2d] Detectron2 model loaded and ready.")
    except Exception as e:
        logger.error("[pose2d] Failed to load Detectron2: %s", e)
        raise
    return _PREDICTOR


def _ensure_repo() -> None:
    if not os.path.exists(_REPO_DIR):
        os.makedirs(_WORK_ROOT, exist_ok=True)
        subprocess.run(
            f"git clone https://github.com/abindeva511/videopose3d.git {_REPO_DIR}",
            shell=True, check=True,
        )


def _read_video_frames(video_path: str):
    """Decode video to raw BGR frames via ffmpeg pipe. Yields numpy (H,W,3)."""
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-of", "csv=p=0", video_path],
        stdout=subprocess.PIPE, check=True,
    )
    w, h = map(int, probe.stdout.decode().strip().split(","))
    pipe = subprocess.Popen(
        ["ffmpeg", "-i", video_path, "-f", "image2pipe",
         "-pix_fmt", "bgr24", "-vsync", "0", "-vcodec", "rawvideo", "-"],
        stdout=subprocess.PIPE, bufsize=-1,
    )
    while True:
        data = pipe.stdout.read(w * h * 3)
        if not data:
            break
        yield np.frombuffer(data, dtype="uint8").reshape((h, w, 3))
    pipe.wait()


def _infer_frames(video_path: str) -> np.ndarray:
    """
    Run in-process Detectron2 on every frame of *video_path*.
    Returns (T, 17, 2) float32 array of (x, y) keypoints in COCO order.
    """
    predictor = _get_predictor()
    frames: list[np.ndarray] = []

    for frame_i, im in enumerate(_read_video_frames(video_path)):
        outputs = predictor(im)["instances"].to("cpu")
        if outputs.has("pred_boxes") and len(outputs.pred_boxes) > 0:
            kps = outputs.pred_keypoints.numpy()   # (N_persons, 17, 3)  x,y,score
            # Pick person with highest mean keypoint score
            best = int(kps[:, :, 2].mean(axis=1).argmax())
            kpts = kps[best, :, :2].astype(np.float32)  # (17, 2)
        else:
            kpts = frames[-1].copy() if frames else np.zeros((17, 2), dtype=np.float32)
        frames.append(kpts)
        if frame_i % 30 == 0:
            logger.info("[pose2d] frame %d done", frame_i)

    return np.stack(frames, axis=0)   # (T, 17, 2)


def run_pipeline_2d(video_bytes: bytes, stem: str = "input") -> bytes:
    """
    Run in-process Detectron2 keypoint detection on *video_bytes*.

    Returns .npz bytes with key 'keypoints_2d' → (T, 17, 2) COCO keypoints.
    Model is loaded once and reused across calls.
    """
    stem = re.sub(r"[^\w.-]", "_", stem)
    _ensure_repo()   # repo needed for sys.path only

    with tempfile.TemporaryDirectory(prefix="pose2d_") as job_dir:
        input_video = os.path.join(job_dir, f"{stem}.mp4")
        with open(input_video, "wb") as fh:
            fh.write(video_bytes)

        # Downsample to 15 fps, max 720p — cuts inference frames in half
        downsampled = os.path.join(job_dir, f"{stem}_ds.mp4")
        subprocess.run(
            ["ffmpeg", "-y", "-i", input_video,
             "-vf", "fps=15,scale=-2:min(ih\\,720)",
             "-c:v", "libx264", "-crf", "23", "-preset", "fast", "-an",
             downsampled],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        os.replace(downsampled, input_video)

        kpts = _infer_frames(input_video)
        logger.info("[pose2d] complete — %d frames %s", kpts.shape[0], kpts.shape)

        buf = io.BytesIO()
        np.savez_compressed(buf, keypoints_2d=kpts)
        return buf.getvalue()

