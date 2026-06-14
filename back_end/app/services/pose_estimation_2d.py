"""
2D Pose Estimation Service (MediaPipe Tasks API)
=================================================
Uses MediaPipe PoseLandmarker (Tasks API, v0.10+) to detect 2D body keypoints.
Output: (T, 17, 2) COCO-order keypoints as .npz — same contract as before.

MediaPipe runs fully on CPU at ~30ms/frame (vs ~300ms/frame for Detectron2),
making form analysis ~10x faster on CPU instances.

MediaPipe 33-landmark → COCO 17 mapping:
  COCO  0 Nose          ← MP  0
  COCO  1 Left Eye      ← MP  2
  COCO  2 Right Eye     ← MP  5
  COCO  3 Left Ear      ← MP  7
  COCO  4 Right Ear     ← MP  8
  COCO  5 Left Shoulder ← MP 11
  COCO  6 Right Shoulder← MP 12
  COCO  7 Left Elbow    ← MP 13
  COCO  8 Right Elbow   ← MP 14
  COCO  9 Left Wrist    ← MP 15
  COCO 10 Right Wrist   ← MP 16
  COCO 11 Left Hip      ← MP 23
  COCO 12 Right Hip     ← MP 24
  COCO 13 Left Knee     ← MP 25
  COCO 14 Right Knee    ← MP 26
  COCO 15 Left Ankle    ← MP 27
  COCO 16 Right Ankle   ← MP 28
"""

from __future__ import annotations

import io
import logging
import os
import re
import subprocess
import tempfile
import threading
import urllib.request

import numpy as np

logger = logging.getLogger(__name__)

# MediaPipe landmark indices that map to COCO 17 keypoints (in order)
_MP_TO_COCO = [0, 2, 5, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]

_MODEL_PATH = "/tmp/pose_landmarker_lite.task"
_MODEL_URL  = (
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    "pose_landmarker_lite/float16/latest/pose_landmarker_lite.task"
)

# Thread-local storage: each thread gets its own PoseLandmarker instance
# (VIDEO mode is stateful and not thread-safe)
_thread_local = threading.local()
# Global lock to prevent concurrent model downloads
_download_lock = threading.Lock()


def _get_pose():
    # Each thread has its own instance (VIDEO mode is not thread-safe)
    if getattr(_thread_local, "pose", None) is not None:
        return _thread_local.pose

    # Ensure model file is downloaded exactly once
    if not os.path.exists(_MODEL_PATH):
        with _download_lock:
            if not os.path.exists(_MODEL_PATH):  # double-checked locking
                logger.info("[pose2d] Downloading model to %s ...", _MODEL_PATH)
                tmp_path = _MODEL_PATH + ".tmp"
                urllib.request.urlretrieve(_MODEL_URL, tmp_path)
                os.replace(tmp_path, _MODEL_PATH)

    logger.info("[pose2d] Loading MediaPipe PoseLandmarker model (thread %s)...", threading.current_thread().name)

    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions
    from mediapipe.tasks.python.vision import PoseLandmarker, PoseLandmarkerOptions, RunningMode

    options = PoseLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=_MODEL_PATH),
        running_mode=RunningMode.VIDEO,
        num_poses=1,
        min_pose_detection_confidence=0.5,
        min_pose_presence_confidence=0.5,
        min_tracking_confidence=0.5,
    )
    _thread_local.pose = PoseLandmarker.create_from_options(options)
    logger.info("[pose2d] MediaPipe PoseLandmarker ready.")
    return _thread_local.pose


def _infer_frames(video_path: str) -> np.ndarray:
    """
    Run MediaPipe PoseLandmarker on every frame of *video_path*.
    Returns (T, 17, 2) float32 array of (x, y) pixel keypoints in COCO order.
    """
    import cv2
    import mediapipe as mp

    landmarker = _get_pose()
    cap = cv2.VideoCapture(video_path)
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 15.0

    frames: list[np.ndarray] = []
    frame_i = 0
    while True:
        ret, bgr = cap.read()
        if not ret:
            break
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        timestamp_ms = int(frame_i * 1000 / fps)
        result = landmarker.detect_for_video(mp_image, timestamp_ms)

        if result.pose_landmarks:
            lm = result.pose_landmarks[0]  # first (and only) person
            kpts = np.array(
                [[lm[idx].x * w, lm[idx].y * h] for idx in _MP_TO_COCO],
                dtype=np.float32,
            )  # (17, 2)
        else:
            kpts = frames[-1].copy() if frames else np.zeros((17, 2), dtype=np.float32)
        frames.append(kpts)
        if frame_i % 30 == 0:
            logger.info("[pose2d] frame %d done", frame_i)
        frame_i += 1

    cap.release()
    return np.stack(frames, axis=0)  # (T, 17, 2)


def run_pipeline_2d(video_bytes: bytes, stem: str = "input") -> bytes:
    """
    Run MediaPipe Pose on *video_bytes*.

    Returns .npz bytes with key 'keypoints_2d' → (T, 17, 2) COCO keypoints.
    """
    stem = re.sub(r"[^\w.-]", "_", stem)

    with tempfile.TemporaryDirectory(prefix="pose2d_") as job_dir:
        input_video = os.path.join(job_dir, f"{stem}.mp4")
        with open(input_video, "wb") as fh:
            fh.write(video_bytes)

        # Downsample to 15 fps, max 720p — keeps frame count manageable
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

        # Reset the thread-local landmarker so the next video starts fresh
        # (VIDEO mode requires monotonically increasing timestamps per instance)
        if getattr(_thread_local, "pose", None) is not None:
            try:
                _thread_local.pose.close()
            except Exception:
                pass
            _thread_local.pose = None

        buf = io.BytesIO()
        np.savez_compressed(buf, keypoints_2d=kpts)
        return buf.getvalue()

