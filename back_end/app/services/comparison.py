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
from concurrent.futures import ThreadPoolExecutor
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
def _cosine_dist_matrix(A: np.ndarray, B: np.ndarray) -> np.ndarray:
    """Vectorized pairwise mean cosine distance. A:(T1,K,3) B:(T2,K,3) → (T1,T2)"""
    A_n = A / np.linalg.norm(A, axis=-1, keepdims=True).clip(min=1e-8)
    B_n = B / np.linalg.norm(B, axis=-1, keepdims=True).clip(min=1e-8)
    # einsum: for each (t1, t2, k) → dot of unit vectors, then mean over k
    dot = np.einsum('ikd,jkd->ijk', A_n, B_n).clip(-1.0, 1.0)  # (T1, T2, K)
    return (1.0 - dot).mean(axis=-1)  # (T1, T2)


def _euclid_dist_matrix(A: np.ndarray, B: np.ndarray) -> np.ndarray:
    """Vectorized pairwise mean Euclidean distance. A:(T1,J,3) B:(T2,J,3) → (T1,T2)"""
    A_sq = (A ** 2).sum(axis=-1)            # (T1, J)
    B_sq = (B ** 2).sum(axis=-1)            # (T2, J)
    dot  = np.einsum('ijd,kjd->ikj', A, B)  # (T1, T2, J)
    dist_sq = (A_sq[:, None, :] + B_sq[None, :, :] - 2 * dot).clip(0)
    return np.sqrt(dist_sq).mean(axis=-1)   # (T1, T2)


def _build_cost_matrix(A: np.ndarray, B: np.ndarray) -> np.ndarray:
    A_c = root_center_pose(A, 0);  B_c = root_center_pose(B, 0)
    A_n, _ = scale_normalize_pose(A_c);  B_n, _ = scale_normalize_pose(B_c)
    A_v = compute_velocities(A_n);       B_v = compute_velocities(B_n)
    A_b = compute_bone_vectors(A_n, BONE_PAIRS)
    B_b = compute_bone_vectors(B_n, BONE_PAIRS)

    bone_cost   = _cosine_dist_matrix(A_b, B_b)   # (T1, T2)
    euclid_cost = _euclid_dist_matrix(A_n, B_n)   # (T1, T2)

    # Velocity term: only contribute where both sequences have meaningful motion
    vm_A = np.linalg.norm(A_v, axis=-1).mean(axis=-1)           # (T1,)
    vm_B = np.linalg.norm(B_v, axis=-1).mean(axis=-1)           # (T2,)
    vel_mask = (vm_A[:, None] > 1e-6) & (vm_B[None, :] > 1e-6) # (T1, T2)
    vel_cost = _cosine_dist_matrix(A_v, B_v)                    # (T1, T2)

    n = 2.0 + vel_mask.astype(np.float32)                       # 2 or 3 per cell
    return (bone_cost + euclid_cost + vel_mask * vel_cost) / n  # (T1, T2)


# ── Angle helpers ──────────────────────────────────────────────────────────────
def _angle(v1: np.ndarray, v2: np.ndarray) -> float:
    v1n = v1 / (np.linalg.norm(v1) + 1e-8)
    v2n = v2 / (np.linalg.norm(v2) + 1e-8)
    return float(np.degrees(np.arccos(np.clip(np.dot(v1n, v2n), -1.0, 1.0))))

def _knee(hip, knee, foot): return _angle(knee - hip, foot - knee)
def _hip(hip, kj, spine):   return _angle(spine - hip, kj - hip)


# ── Frame extractor ────────────────────────────────────────────────────────────
def _extract_frames_b64(video_bytes: bytes, frame_indices: list[int]) -> list[str]:
    """Open video once, extract multiple frames in one pass, return JPEG base64 list."""
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

    # ── Pre-compute per-frame angles + spine polys ─────────────────────────────
    frame_data = []
    for fi, pos in enumerate(frame_pos):
        pose_A = A_ov[pos]
        pose_B = B_ov[pos]
        pts_A = pose_A[[0, 7, 8], :]
        pts_B = pose_B[[0, 7, 8], :]
        pA = {ax: np.polyfit(t_poly, pts_A[:, i], deg=2) for i, ax in enumerate(["X","Y","Z"])}
        pB = {ax: np.polyfit(t_poly, pts_B[:, i], deg=2) for i, ax in enumerate(["X","Y","Z"])}
        frame_data.append({
            "fi":               fi,
            "user_frame_no":    a_indices[pos],
            "ref_frame_no":     b_indices[pos],
            "pose_A":           pose_A,
            "pose_B":           pose_B,
            "pA":               pA,
            "pB":               pB,
        })

    # ── GPT calls in parallel ─────────────────────────────────────────────────
    with ThreadPoolExecutor(max_workers=N_SELECTED_FRAMES) as pool:
        gpt_futures = [
            pool.submit(_gpt_spine, fd["pA"], fd["pB"], fd["fi"], openai_api_key)
            for fd in frame_data
        ]
        spine_texts = [f.result() for f in gpt_futures]

    # ── Batch frame extraction (open each video once) ─────────────────────────
    user_frame_nos = [fd["user_frame_no"] for fd in frame_data]
    ref_frame_nos  = [fd["ref_frame_no"]  for fd in frame_data]
    user_imgs = _extract_frames_b64(user_video_bytes, user_frame_nos)
    ref_imgs  = _extract_frames_b64(ref_video_bytes,  ref_frame_nos)

    # ── Assemble payload ───────────────────────────────────────────────────────
    frames_out = []
    for fi, fd in enumerate(frame_data):
        pose_A, pose_B = fd["pose_A"], fd["pose_B"]
        frames_out.append({
            "idx":               fi,
            "user_frame_no":     fd["user_frame_no"],
            "ref_frame_no":      fd["ref_frame_no"],
            "user_image":        user_imgs[fi],
            "ref_image":         ref_imgs[fi],
            "right_knee_you":    round(_knee(pose_A[1], pose_A[2], pose_A[3]), 1),
            "right_knee_ref":    round(_knee(pose_B[1], pose_B[2], pose_B[3]), 1),
            "left_knee_you":     round(_knee(pose_A[4], pose_A[5], pose_A[6]), 1),
            "left_knee_ref":     round(_knee(pose_B[4], pose_B[5], pose_B[6]), 1),
            "right_hip_you":     round(_hip(pose_A[0], pose_A[1], pose_A[7]), 1),
            "right_hip_ref":     round(_hip(pose_B[0], pose_B[1], pose_B[7]), 1),
            "left_hip_you":      round(_hip(pose_A[0], pose_A[4], pose_A[7]), 1),
            "left_hip_ref":      round(_hip(pose_B[0], pose_B[4], pose_B[7]), 1),
            "spine_coaching":    spine_texts[fi],
        })

    return {
        "dtw_cost":        round(float(total_cost), 3),
        "n_matched_frames": n,
        "frames":          frames_out,
    }
