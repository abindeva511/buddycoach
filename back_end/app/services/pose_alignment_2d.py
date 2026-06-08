"""
2D Pose Alignment Math Library
================================
Mirror of pose_alignment_open_dtw.py rewritten for 2D (x, y) keypoints.
All functions operate on arrays of shape (T, J, 2) instead of (T, J, 3).

DTW functions (dtw_fully_open, extract_path_mapping) are dimension-agnostic
and are re-exported directly from the 3D library.
"""

from __future__ import annotations

import numpy as np
from typing import List, Optional, Tuple

# Re-export DTW functions unchanged — they operate on cost matrices only
from pose_alignment_open_dtw import dtw_fully_open, extract_path_mapping


# ── COCO (Detectron2 output) → H36M joint remapping ──────────────────────────
# COCO 17 joints:
#   0  nose        1  l_eye       2  r_eye       3  l_ear       4  r_ear
#   5  l_shoulder  6  r_shoulder  7  l_elbow     8  r_elbow     9  l_wrist
#   10 r_wrist    11  l_hip      12  r_hip      13  l_knee     14  r_knee
#   15 l_ankle    16  r_ankle
#
# H36M 17 joints:
#   0  Hip        1  RHip        2  RKnee       3  RAnkle      4  LHip
#   5  LKnee      6  LAnkle      7  Spine       8  Thorax      9  Neck
#  10  Head      11  LShoulder  12  LElbow      13  LWrist     14  RShoulder
#  15  RElbow    16  RWrist

def coco_to_h36m(kpts: np.ndarray) -> np.ndarray:
    """
    Remap a (T, 17, 2) COCO keypoint array to H36M joint order.

    Missing/synthetic joints (Hip, Spine, Thorax, Neck) are computed as
    midpoints of their neighbouring joints.

    Args:
        kpts: shape (T, 17, 2) in COCO order

    Returns:
        shape (T, 17, 2) in H36M order
    """
    T = kpts.shape[0]
    out = np.zeros((T, 17, 2), dtype=np.float32)

    # ── Direct mappings ────────────────────────────────────────────────────────
    out[:, 1,  :] = kpts[:, 12, :]   # RHip     ← r_hip
    out[:, 2,  :] = kpts[:, 14, :]   # RKnee    ← r_knee
    out[:, 3,  :] = kpts[:, 16, :]   # RAnkle   ← r_ankle
    out[:, 4,  :] = kpts[:, 11, :]   # LHip     ← l_hip
    out[:, 5,  :] = kpts[:, 13, :]   # LKnee    ← l_knee
    out[:, 6,  :] = kpts[:, 15, :]   # LAnkle   ← l_ankle
    out[:, 10, :] = kpts[:, 0,  :]   # Head     ← nose
    out[:, 11, :] = kpts[:, 5,  :]   # LShoulder← l_shoulder
    out[:, 12, :] = kpts[:, 7,  :]   # LElbow   ← l_elbow
    out[:, 13, :] = kpts[:, 9,  :]   # LWrist   ← l_wrist
    out[:, 14, :] = kpts[:, 6,  :]   # RShoulder← r_shoulder
    out[:, 15, :] = kpts[:, 8,  :]   # RElbow   ← r_elbow
    out[:, 16, :] = kpts[:, 10, :]   # RWrist   ← r_wrist

    # ── Synthetic joints (midpoints) ──────────────────────────────────────────
    out[:, 0, :]  = (kpts[:, 11, :] + kpts[:, 12, :]) / 2.0  # Hip
    out[:, 7, :]  = (out[:, 0, :] + (kpts[:, 5, :] + kpts[:, 6, :]) / 2.0) / 2.0  # Spine
    out[:, 8, :]  = (kpts[:, 5,  :] + kpts[:, 6,  :]) / 2.0  # Thorax
    out[:, 9, :]  = (kpts[:, 3,  :] + kpts[:, 4,  :]) / 2.0  # Neck (mid-ears)

    return out


# ── Preprocessing ─────────────────────────────────────────────────────────────

def root_center_pose_2d(pose: np.ndarray, root_idx: int = 0) -> np.ndarray:
    """Center skeleton by subtracting root joint. pose: (T, J, 2)"""
    return pose - pose[:, root_idx:root_idx + 1, :]


def scale_normalize_pose_2d(pose: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    """
    Scale-normalize (T, J, 2) by mean pairwise joint distance per frame.
    Returns (normalized_pose, scales).
    """
    T, J, _ = pose.shape
    scales = np.zeros(T, dtype=np.float32)
    for t in range(T):
        diffs = pose[t, :, np.newaxis, :] - pose[t, np.newaxis, :, :]  # (J,J,2)
        distances = np.linalg.norm(diffs, axis=-1)                      # (J,J)
        mask = ~np.eye(J, dtype=bool)
        scale = distances[mask].mean() if distances[mask].size > 0 else 1.0
        scales[t] = scale if scale > 1e-8 else 1.0
    return pose / scales[:, np.newaxis, np.newaxis], scales


def compute_velocities_2d(pose: np.ndarray) -> np.ndarray:
    """Centered finite differences. pose/return: (T, J, 2)"""
    T = pose.shape[0]
    vel = np.zeros_like(pose, dtype=np.float32)
    if T > 2:
        vel[1:-1] = (pose[2:] - pose[:-2]) / 2.0
    if T > 1:
        vel[0]  = pose[1]  - pose[0]
        vel[-1] = pose[-1] - pose[-2]
    return vel


def compute_bone_vectors_2d(pose: np.ndarray, bone_pairs: List[Tuple[int, int]]) -> np.ndarray:
    """Bone direction vectors. Returns (T, num_bones, 2)"""
    T, _, _ = pose.shape
    bones = np.zeros((T, len(bone_pairs), 2), dtype=np.float32)
    for b, (i, j) in enumerate(bone_pairs):
        bones[:, b, :] = pose[:, j, :] - pose[:, i, :]
    return bones


# ── Vectorized distance matrices ─────────────────────────────────────────────

def _cosine_dist_matrix_2d(A: np.ndarray, B: np.ndarray) -> np.ndarray:
    """A:(T1,K,2) B:(T2,K,2) → (T1,T2) mean cosine distance"""
    A_n = A / np.linalg.norm(A, axis=-1, keepdims=True).clip(min=1e-8)
    B_n = B / np.linalg.norm(B, axis=-1, keepdims=True).clip(min=1e-8)
    dot = np.einsum('ikd,jkd->ijk', A_n, B_n).clip(-1.0, 1.0)  # (T1,T2,K)
    return (1.0 - dot).mean(axis=-1)


def _euclid_dist_matrix_2d(A: np.ndarray, B: np.ndarray) -> np.ndarray:
    """A:(T1,J,2) B:(T2,J,2) → (T1,T2) mean Euclidean distance"""
    A_sq = (A ** 2).sum(axis=-1)             # (T1,J)
    B_sq = (B ** 2).sum(axis=-1)             # (T2,J)
    dot  = np.einsum('ijd,kjd->ikj', A, B)  # (T1,T2,J)
    dist_sq = (A_sq[:, None, :] + B_sq[None, :, :] - 2 * dot).clip(0)
    return np.sqrt(dist_sq).mean(axis=-1)


# ── Joint setup ───────────────────────────────────────────────────────────────

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
    [(0, 1), (1, 2), (2, 3), (0, 4), (4, 5), (5, 6)] +  # legs
    [(0, 7), (7, 8), (8, 9), (9, 10)]                    # spine
)
BONE_PAIRS_2D = [(idx_map[a], idx_map[b]) for a, b in _all_chains if a in idx_map and b in idx_map]


def build_cost_matrix_2d(A: np.ndarray, B: np.ndarray) -> np.ndarray:
    """
    Build pairwise cost matrix for open-DTW alignment.
    A, B: (T, J, 2) in H36M order, selected joints already sliced.
    Returns (T1, T2) float32 cost matrix.
    """
    A_c = root_center_pose_2d(A, 0);      B_c = root_center_pose_2d(B, 0)
    A_n, _ = scale_normalize_pose_2d(A_c); B_n, _ = scale_normalize_pose_2d(B_c)
    A_v = compute_velocities_2d(A_n);      B_v = compute_velocities_2d(B_n)
    A_b = compute_bone_vectors_2d(A_n, BONE_PAIRS_2D)
    B_b = compute_bone_vectors_2d(B_n, BONE_PAIRS_2D)

    bone_cost   = _cosine_dist_matrix_2d(A_b, B_b)
    euclid_cost = _euclid_dist_matrix_2d(A_n, B_n)

    vm_A = np.linalg.norm(A_v, axis=-1).mean(axis=-1)
    vm_B = np.linalg.norm(B_v, axis=-1).mean(axis=-1)
    vel_mask = (vm_A[:, None] > 1e-6) & (vm_B[None, :] > 1e-6)
    vel_cost = _cosine_dist_matrix_2d(A_v, B_v)

    n = 2.0 + vel_mask.astype(np.float32)
    return (bone_cost + euclid_cost + vel_mask * vel_cost) / n


# ── 2D angle helpers ─────────────────────────────────────────────────────────

def _angle_2d(v1: np.ndarray, v2: np.ndarray) -> float:
    """Angle in degrees between two 2D vectors."""
    n1 = np.linalg.norm(v1) + 1e-8
    n2 = np.linalg.norm(v2) + 1e-8
    cos_a = np.clip(np.dot(v1 / n1, v2 / n2), -1.0, 1.0)
    return float(np.degrees(np.arccos(cos_a)))


def knee_angle_2d(hip: np.ndarray, knee: np.ndarray, ankle: np.ndarray) -> float:
    """Knee flexion angle from hip, knee, ankle 2D points."""
    return _angle_2d(knee - hip, ankle - knee)


def hip_angle_2d(hip: np.ndarray, knee_joint: np.ndarray, spine: np.ndarray) -> float:
    """Hip angle between spine direction and thigh direction."""
    return _angle_2d(spine - hip, knee_joint - hip)
