"""
2D Form Comparison Service
===========================
DTW alignment + joint angle analysis + GPT coaching on two 2D pose NPZ files.

Identical pipeline to comparison.py but:
- Input: (T, 17, 2) COCO keypoints from Detectron2 (no VideoPose3D)
- COCO → H36M remapping applied after loading
- All math in 2D (bone vectors, angles, polynomials)
- Spine polynomial uses only X(t) and Y(t) (no Z)
- GPT prompt adapted for 2D
"""

from __future__ import annotations

import base64
import io
import os
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import cv2
import numpy as np

_HERE = os.path.dirname(__file__)
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from pose_alignment_2d import (
    coco_to_h36m,
    build_cost_matrix_2d,
    selected_indices,
    knee_angle_2d,
    hip_angle_2d,
    dtw_fully_open,
    extract_path_mapping,
)

N_SELECTED_FRAMES = 3


# ── Frame extractor (unchanged from 3D version) ────────────────────────────────
def _extract_frames_b64(video_bytes: bytes, frame_indices: list[int]) -> list[str]:
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
        tmp.write(video_bytes)
        tmp_path = tmp.name
    try:
        cap = cv2.VideoCapture(tmp_path)
        frame_map: dict[int, str] = {}
        for idx in sorted(set(frame_indices)):
            cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
            ret, frame = cap.read()
            if not ret:
                frame = np.full((100, 100, 3), 128, dtype=np.uint8)
            _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
            frame_map[idx] = "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode()
        cap.release()
        return [frame_map[i] for i in frame_indices]
    finally:
        os.unlink(tmp_path)


# ── GPT spine analysis (2D — no Z axis) ──────────────────────────────────────
def _gpt_spine_2d(poly_A: dict, poly_B: dict, frame_idx: int, api_key: str) -> str:
    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key)
        pA, pB = poly_A, poly_B
        user_content = (
            f"Frame {frame_idx}:\n\n"
            f"Video A (your form):\n"
            f"X(t)={pA['X'][0]:.4f}t²+{pA['X'][1]:.4f}t+{pA['X'][2]:.4f}\n"
            f"Y(t)={pA['Y'][0]:.4f}t²+{pA['Y'][1]:.4f}t+{pA['Y'][2]:.4f}\n\n"
            f"Video B (reference):\n"
            f"X(t)={pB['X'][0]:.4f}t²+{pB['X'][1]:.4f}t+{pB['X'][2]:.4f}\n"
            f"Y(t)={pB['Y'][0]:.4f}t²+{pB['Y'][1]:.4f}t+{pB['Y'][2]:.4f}\n\n"
            f"Analyze and compare."
        )
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": (
                    "You are a friendly fitness coach giving feedback on exercise form. "
                    "I will give you 2D spine curve data from two videos (side view). "
                    "t=0 is hips, t=1 is mid-back, t=2 is shoulders. "
                    "X = horizontal position (lean), Y = vertical (height). "
                    "Reply in plain text only — no markdown, no hashtags, no bullet symbols, no tables. "
                    "Use this exact structure with these exact labels on separate lines:\n"
                    "SUMMARY: (1-2 sentences describing each person's posture)\n"
                    "YOUR FORM: (1 sentence on what the user is doing)\n"
                    "REFERENCE: (1 sentence on what the reference is doing)\n"
                    "TIP: (1 concrete actionable tip to improve)"
                )},
                {"role": "user", "content": user_content},
            ],
            temperature=0.7,
            max_tokens=300,
        )
        return resp.choices[0].message.content
    except Exception as exc:
        return f"(GPT unavailable: {exc})"


# ── Main entry point ──────────────────────────────────────────────────────────
def run_comparison_2d(
    user_npz_bytes: bytes,
    ref_npz_bytes: bytes,
    user_video_bytes: bytes,
    ref_video_bytes: bytes,
    openai_api_key: str,
) -> dict[str, Any]:
    """
    Full 2D pipeline: load → remap → DTW → frame selection → angles → spine → GPT.
    Returns the same dict shape as run_comparison() so ResultScreen needs no changes.
    """

    def _load(b: bytes) -> np.ndarray:
        d = np.load(io.BytesIO(b), allow_pickle=True)
        arr = d["keypoints_2d"].astype(np.float32)   # (T, 17, 2) COCO order
        # Flip Y so that up = increasing Y (pixel Y is inverted)
        arr[:, :, 1] = arr[:, :, 1].max() - arr[:, :, 1]
        return coco_to_h36m(arr)                      # → (T, 17, 2) H36M order

    A = _load(user_npz_bytes)   # (T1, 17, 2)
    B = _load(ref_npz_bytes)    # (T2, 17, 2)

    A_sel = A[:, selected_indices, :]
    B_sel = B[:, selected_indices, :]

    # ── DTW alignment ──────────────────────────────────────────────────────────
    cost_matrix = build_cost_matrix_2d(A_sel, B_sel)
    _, dtw_path, total_cost = dtw_fully_open(cost_matrix, pen_h=1.0, pen_v=1.0, pen_d=1.0)
    _, _, _, _, map_A_to_B = extract_path_mapping(dtw_path, len(A_sel), len(B_sel))

    a_indices = sorted(map_A_to_B.keys())
    b_indices  = [map_A_to_B[a] for a in a_indices]

    A_ov = A[a_indices]   # (n, 17, 2)
    B_ov = B[b_indices]   # (n, 17, 2)

    # ── 3 equidistant representative frames ───────────────────────────────────
    n = len(A_ov)
    frame_pos = np.linspace(0, n - 1, N_SELECTED_FRAMES, dtype=int)

    t_poly = np.array([0, 1, 2])

    frame_data = []
    for fi, pos in enumerate(frame_pos):
        pose_A = A_ov[pos]   # (17, 2)
        pose_B = B_ov[pos]   # (17, 2)
        # Spine points: Hip(0), Spine(7), Thorax(8)
        pts_A = pose_A[[0, 7, 8], :]
        pts_B = pose_B[[0, 7, 8], :]
        pA = {ax: np.polyfit(t_poly, pts_A[:, i], deg=2) for i, ax in enumerate(["X", "Y"])}
        pB = {ax: np.polyfit(t_poly, pts_B[:, i], deg=2) for i, ax in enumerate(["X", "Y"])}
        frame_data.append({
            "fi":            fi,
            "user_frame_no": a_indices[pos],
            "ref_frame_no":  b_indices[pos],
            "pose_A":        pose_A,
            "pose_B":        pose_B,
            "pA":            pA,
            "pB":            pB,
        })

    # ── GPT calls in parallel ─────────────────────────────────────────────────
    with ThreadPoolExecutor(max_workers=N_SELECTED_FRAMES) as pool:
        gpt_futures = [
            pool.submit(_gpt_spine_2d, fd["pA"], fd["pB"], fd["fi"], openai_api_key)
            for fd in frame_data
        ]
        spine_texts = [f.result() for f in gpt_futures]

    # ── Batch frame extraction ────────────────────────────────────────────────
    user_frame_nos = [fd["user_frame_no"] for fd in frame_data]
    ref_frame_nos  = [fd["ref_frame_no"]  for fd in frame_data]
    user_imgs = _extract_frames_b64(user_video_bytes, user_frame_nos)
    ref_imgs  = _extract_frames_b64(ref_video_bytes,  ref_frame_nos)

    # ── Assemble payload ──────────────────────────────────────────────────────
    frames_out = []
    for fi, fd in enumerate(frame_data):
        pA, pB = fd["pose_A"], fd["pose_B"]
        frames_out.append({
            "idx":               fi,
            "user_frame_no":     fd["user_frame_no"],
            "ref_frame_no":      fd["ref_frame_no"],
            "user_image":        user_imgs[fi],
            "ref_image":         ref_imgs[fi],
            # H36M indices: RHip=1 RKnee=2 RAnkle=3 LHip=4 LKnee=5 LAnkle=6 LShoulder=11 RShoulder=14
            "right_knee_you":    round(knee_angle_2d(pA[1], pA[2], pA[3]), 1),
            "right_knee_ref":    round(knee_angle_2d(pB[1], pB[2], pB[3]), 1),
            "left_knee_you":     round(knee_angle_2d(pA[4], pA[5], pA[6]), 1),
            "left_knee_ref":     round(knee_angle_2d(pB[4], pB[5], pB[6]), 1),
            "right_hip_you":     round(hip_angle_2d(pA[14], pA[1], pA[2]), 1),
            "right_hip_ref":     round(hip_angle_2d(pB[14], pB[1], pB[2]), 1),
            "left_hip_you":      round(hip_angle_2d(pA[11], pA[4], pA[5]), 1),
            "left_hip_ref":      round(hip_angle_2d(pB[11], pB[4], pB[5]), 1),
            "spine_coaching":    spine_texts[fi],
        })

    return {
        "dtw_cost":         round(float(total_cost), 3),
        "n_matched_frames": n,
        "frames":           frames_out,
    }
