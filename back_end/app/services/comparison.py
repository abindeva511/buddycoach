"""
Form comparison service.
Runs DTW alignment + spine/knee analysis + GPT coaching on two pose NPZ files,
then extracts matching video frames and returns the full comparison payload.
"""

from __future__ import annotations

import base64
import io
import os
import sys
import tempfile
from typing import Any

import cv2
import numpy as np

# ── Import DTW helpers from the sibling module ─────────────────────────────────
_HERE = os.path.dirname(__file__)
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from pose_alignment_open_dtw import (
    dtw_fully_open,
    extract_path_mapping,
    root_center_pose,
    scale_normalize_pose,
    compute_velocities,
    compute_bone_vectors,
    cosine_distance,
    euclidean_distance,
)

# ── Joint indices (H36M) ───────────────────────────────────────────────────────
USE_LEGS  = True
USE_SPINE = True
USE_ARMS  = False

LEGS_INDICES  = [0, 1, 2, 3, 4, 5, 6]
SPINE_INDICES = [7, 8, 9, 10]

selected_indices = sorted(
    set((LEGS_INDICES if USE_LEGS else []) + (SPINE_INDICES if USE_SPINE else []))
)

idx_map     = {orig: new for new, orig in enumerate(selected_indices)}
_all_chains = (
    [(0,1),(1,2),(2,3),(0,4),(4,5),(5,6)] +  # legs
    [(0,7),(7,8),(8,9),(9,10)]                # spine
)
BONE_PAIRS = [(idx_map[a], idx_map[b]) for a, b in _all_chains if a in idx_map and b in idx_map]

N_SELECTED_FRAMES = 3


# ── Cost matrix ────────────────────────────────────────────────────────────────
def _build_cost_matrix(A: np.ndarray, B: np.ndarray) -> np.ndarray:
    A_c = root_center_pose(A, 0);  B_c = root_center_pose(B, 0)
    A_n, _ = scale_normalize_pose(A_c);  B_n, _ = scale_normalize_pose(B_c)
    A_v = compute_velocities(A_n);       B_v = compute_velocities(B_n)
    A_b = compute_bone_vectors(A_n, BONE_PAIRS)
    B_b = compute_bone_vectors(B_n, BONE_PAIRS)

    T1, T2 = len(A), len(B)
    cost = np.zeros((T1, T2), dtype=np.float32)
    for t1 in range(T1):
        for t2 in range(T2):
            fc, n = 0.0, 0
            fc += cosine_distance(A_b[t1], B_b[t2]).mean();  n += 1
            vm_A = np.linalg.norm(A_v[t1], axis=-1)
            vm_B = np.linalg.norm(B_v[t2], axis=-1)
            if vm_A.mean() > 1e-6 and vm_B.mean() > 1e-6:
                fc += cosine_distance(A_v[t1], B_v[t2]).mean(); n += 1
            fc += euclidean_distance(A_n[t1], B_n[t2]).mean(); n += 1
            cost[t1, t2] = fc / n
    return cost


# ── Angle helpers ──────────────────────────────────────────────────────────────
def _angle(v1: np.ndarray, v2: np.ndarray) -> float:
    v1n = v1 / (np.linalg.norm(v1) + 1e-8)
    v2n = v2 / (np.linalg.norm(v2) + 1e-8)
    return float(np.degrees(np.arccos(np.clip(np.dot(v1n, v2n), -1.0, 1.0))))

def _knee(hip, knee, foot): return _angle(knee - hip, foot - knee)
def _hip(hip, kj, spine):   return _angle(spine - hip, kj - hip)


# ── Frame extractor ────────────────────────────────────────────────────────────
def _extract_frame_b64(video_bytes: bytes, frame_idx: int) -> str:
    """Write video to a temp file, extract one frame, return as JPEG base64."""
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
        tmp.write(video_bytes)
        tmp_path = tmp.name
    try:
        cap = cv2.VideoCapture(tmp_path)
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        ret, frame = cap.read()
        cap.release()
        if not ret:
            # return 1×1 grey placeholder
            frame = np.full((100, 100, 3), 128, dtype=np.uint8)
        _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        return "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode()
    finally:
        os.unlink(tmp_path)


# ── GPT spine analysis ─────────────────────────────────────────────────────────
def _gpt_spine(poly_A: dict, poly_B: dict, frame_idx: int, api_key: str) -> str:
    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key)
        pA, pB = poly_A, poly_B
        user_content = (
            f"Frame {frame_idx}:\n\n"
            f"Video A:\nX(t)={pA['X'][0]:.4f}t²+{pA['X'][1]:.4f}t+{pA['X'][2]:.4f}\n"
            f"Y(t)={pA['Y'][0]:.4f}t²+{pA['Y'][1]:.4f}t+{pA['Y'][2]:.4f}\n"
            f"Z(t)={pA['Z'][0]:.4f}t²+{pA['Z'][1]:.4f}t+{pA['Z'][2]:.4f}\n\n"
            f"Video B:\nX(t)={pB['X'][0]:.4f}t²+{pB['X'][1]:.4f}t+{pB['X'][2]:.4f}\n"
            f"Y(t)={pB['Y'][0]:.4f}t²+{pB['Y'][1]:.4f}t+{pB['Y'][2]:.4f}\n"
            f"Z(t)={pB['Z'][0]:.4f}t²+{pB['Z'][1]:.4f}t+{pB['Z'][2]:.4f}\n\nAnalyze and compare."
        )
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": (
                    "You are a body movement coach. I will give you 3D spine curves for two videos. "
                    "t=0 is Hip, t=1 is Mid-spine, t=2 is Thorax. "
                    "Explain in simple language: how curved each spine is, which direction it bends, "
                    "which is more upright. Give a short summary (5 lines max), a simple comparison table, "
                    "and a final verdict. No formulas, no math terms."
                )},
                {"role": "user", "content": user_content},
            ],
            temperature=0.7,
            max_tokens=600,
        )
        return resp.choices[0].message.content
    except Exception as exc:
        return f"(GPT unavailable: {exc})"


# ── Main entry point ────────────────────────────────────────────────────────────
def run_comparison(
    user_npz_bytes: bytes,
    ref_npz_bytes: bytes,
    user_video_bytes: bytes,
    ref_video_bytes: bytes,
    openai_api_key: str,
) -> dict[str, Any]:
    """
    Full pipeline: DTW → frame selection → angles → spine poly → GPT.
    Returns a dict that the /compare API endpoint serialises as JSON.
    """

    # ── Load & normalise poses ─────────────────────────────────────────────────
    def _load_npz(b: bytes) -> np.ndarray:
        d = np.load(io.BytesIO(b), allow_pickle=True)
        arr = d[d.files[0]].astype(np.float32) if hasattr(d, "files") else d.astype(np.float32)
        arr[:, :, 1] *= -1   # Y-flip (VideoPose3D → Y-up)
        return arr

    A = _load_npz(user_npz_bytes)   # (T1, 17, 3)
    B = _load_npz(ref_npz_bytes)    # (T2, 17, 3)

    A_sel = A[:, selected_indices, :]
    B_sel = B[:, selected_indices, :]

    # ── DTW alignment ──────────────────────────────────────────────────────────
    cost_matrix = _build_cost_matrix(A_sel, B_sel)
    _, dtw_path, total_cost = dtw_fully_open(cost_matrix, pen_h=1.0, pen_v=1.0, pen_d=1.0)
    _, _, _, _, map_A_to_B = extract_path_mapping(dtw_path, len(A_sel), len(B_sel))

    a_indices = sorted(map_A_to_B.keys())
    b_indices  = [map_A_to_B[a] for a in a_indices]

    A_ov = A[a_indices]   # (n, 17, 3)
    B_ov = B[b_indices]   # (n, 17, 3)

    # ── 3 equidistant representative frames ────────────────────────────────────
    n = len(A_ov)
    frame_pos = np.linspace(0, n - 1, N_SELECTED_FRAMES, dtype=int)

    # ── Spine joints: Hip(0), Spine(7), Thorax(8) only (indices 0,1,2 of the 3) ─
    t_poly = np.array([0, 1, 2])

    # ── Build per-frame payload ────────────────────────────────────────────────
    frames_out = []
    for fi, pos in enumerate(frame_pos):
        user_vid_frame_no = a_indices[pos]
        ref_vid_frame_no  = b_indices[pos]

        pose_A = A_ov[pos]
        pose_B = B_ov[pos]

        # Angles
        rk_you = _knee(pose_A[1], pose_A[2], pose_A[3])
        rk_ref = _knee(pose_B[1], pose_B[2], pose_B[3])
        lk_you = _knee(pose_A[4], pose_A[5], pose_A[6])
        lk_ref = _knee(pose_B[4], pose_B[5], pose_B[6])
        rh_you = _hip(pose_A[0], pose_A[1], pose_A[7])
        rh_ref = _hip(pose_B[0], pose_B[1], pose_B[7])
        lh_you = _hip(pose_A[0], pose_A[4], pose_A[7])
        lh_ref = _hip(pose_B[0], pose_B[4], pose_B[7])

        # Spine polynomial (Hip=0, Spine=7, Thorax=8)
        pts_A = pose_A[[0, 7, 8], :]
        pts_B = pose_B[[0, 7, 8], :]
        pA = {ax: np.polyfit(t_poly, pts_A[:, i], deg=2) for i, ax in enumerate(["X","Y","Z"])}
        pB = {ax: np.polyfit(t_poly, pts_B[:, i], deg=2) for i, ax in enumerate(["X","Y","Z"])}

        # GPT spine analysis
        spine_text = _gpt_spine(pA, pB, fi, openai_api_key)

        # Video frames
        user_img = _extract_frame_b64(user_video_bytes, user_vid_frame_no)
        ref_img  = _extract_frame_b64(ref_video_bytes,  ref_vid_frame_no)

        frames_out.append({
            "idx":               fi,
            "user_frame_no":     user_vid_frame_no,
            "ref_frame_no":      ref_vid_frame_no,
            "user_image":        user_img,
            "ref_image":         ref_img,
            "right_knee_you":    round(rk_you, 1),
            "right_knee_ref":    round(rk_ref, 1),
            "left_knee_you":     round(lk_you, 1),
            "left_knee_ref":     round(lk_ref, 1),
            "right_hip_you":     round(rh_you, 1),
            "right_hip_ref":     round(rh_ref, 1),
            "left_hip_you":      round(lh_you, 1),
            "left_hip_ref":      round(lh_ref, 1),
            "spine_coaching":    spine_text,
        })

    return {
        "dtw_cost":        round(float(total_cost), 3),
        "n_matched_frames": n,
        "frames":          frames_out,
    }
