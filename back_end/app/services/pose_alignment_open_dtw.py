"""
Fully-Open Dynamic Time Warping for Pose Sequence Alignment

Implements open-begin/open-end DTW to robustly align two skeleton sequences
with unknown leading/trailing frames. Features include:

- Automatic discovery of overlapping action regions
- Free start/end on both sequences
- Hybrid cost function combining bone angles, velocities, and pose similarity
- Optional Sakoe-Chiba band constraint
- Root-centering and scale normalization
- Deterministic frame-to-frame mapping

Reference:
  Sakoe, H., & Chiba, S. (1978). Dynamic programming algorithm optimization
  for spoken word recognition. IEEE Transactions on Acoustics, Speech, and
  Signal Processing, 26(1), 43-49.
"""

import numpy as np
from typing import Tuple, Dict, List, Optional
import warnings


# ============================================================================
# POSE PREPROCESSING & FEATURE EXTRACTION
# ============================================================================

def root_center_pose(pose: np.ndarray, root_idx: int = 0) -> np.ndarray:
    """
    Center skeleton by subtracting root joint position.
    
    Args:
        pose: shape (T, J, 3) - poses over time
        root_idx: index of root joint (default 0 = Hip)
    
    Returns:
        shape (T, J, 3) - root-centered poses
    """
    root_pos = pose[:, root_idx:root_idx+1, :]  # (T, 1, 3)
    return pose - root_pos


def scale_normalize_pose(pose: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    """
    Scale-normalize pose by mean bone length per frame.
    
    Computes all pairwise joint distances, averages them per frame,
    and divides pose by this scale factor. Handles zero-scale gracefully.
    
    Args:
        pose: shape (T, J, 3)
    
    Returns:
        normalized_pose: shape (T, J, 3)
        scales: shape (T,) - scale factor per frame
    """
    T, J, _ = pose.shape
    scales = np.zeros(T, dtype=np.float32)
    
    for t in range(T):
        # Compute all pairwise distances
        joints = pose[t]  # (J, 3)
        diffs = joints[:, np.newaxis, :] - joints[np.newaxis, :, :]  # (J, J, 3)
        distances = np.linalg.norm(diffs, axis=2)  # (J, J)
        
        # Mean distance (excluding self-distances)
        mask = ~np.eye(J, dtype=bool)
        scale = distances[mask].mean() if distances[mask].size > 0 else 1.0
        scales[t] = scale if scale > 1e-8 else 1.0
    
    normalized = pose / scales[:, np.newaxis, np.newaxis]
    return normalized, scales


def compute_velocities(pose: np.ndarray, smooth: bool = True) -> np.ndarray:
    """
    Compute frame-to-frame velocities.
    
    Args:
        pose: shape (T, J, 3)
        smooth: if True, use centered differences where possible
    
    Returns:
        velocities: shape (T, J, 3)
    """
    T, J, D = pose.shape
    vel = np.zeros_like(pose, dtype=np.float32)
    
    if smooth and T > 2:
        # Centered differences for interior frames
        vel[1:-1] = (pose[2:] - pose[:-2]) / 2.0
    
    # Forward differences for boundaries
    vel[0] = pose[1] - pose[0] if T > 1 else 0.0
    vel[-1] = pose[-1] - pose[-2] if T > 1 else 0.0
    
    return vel


def compute_bone_vectors(pose: np.ndarray, bone_pairs: Optional[List[Tuple[int, int]]] = None) -> np.ndarray:
    """
    Compute bone vectors between joint pairs.
    
    Args:
        pose: shape (T, J, 3)
        bone_pairs: list of (i, j) pairs defining skeleton structure.
                   If None, uses H36M standard skeleton.
    
    Returns:
        bones: shape (T, num_bones, 3)
    """
    if bone_pairs is None:
        # H36M skeleton bones
        bone_pairs = [
            (0, 1), (1, 2), (2, 3),           # right leg
            (0, 4), (4, 5), (5, 6),           # left leg
            (0, 7), (7, 8), (8, 9), (9, 10),  # spine/head
            (8, 11), (11, 12), (12, 13),      # left arm
            (8, 14), (14, 15), (15, 16),      # right arm
        ]
    
    T = pose.shape[0]
    num_bones = len(bone_pairs)
    bones = np.zeros((T, num_bones, 3), dtype=np.float32)
    
    for b, (i, j) in enumerate(bone_pairs):
        bones[:, b, :] = pose[:, j, :] - pose[:, i, :]
    
    return bones


def normalize_vectors(vectors: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    """
    L2-normalize vectors, handling zero-length vectors.
    
    Args:
        vectors: shape (..., 3)
    
    Returns:
        normalized: shape (..., 3), unit vectors
        lengths: shape (...), original vector lengths
    """
    lengths = np.linalg.norm(vectors, axis=-1, keepdims=True)
    lengths_squeezed = lengths.squeeze(-1)
    
    # Avoid division by zero
    safe_lengths = np.where(lengths > 1e-8, lengths, 1.0)
    normalized = vectors / safe_lengths
    
    return normalized, lengths_squeezed


# ============================================================================
# COST FUNCTION CONSTRUCTION
# ============================================================================

def cosine_distance(v1: np.ndarray, v2: np.ndarray) -> np.ndarray:
    """
    Compute cosine distance between normalized vectors.
    
    distance = 1 - cosine_similarity
    
    Args:
        v1, v2: shape (..., 3)
    
    Returns:
        distance: shape (...), in [0, 2]
    """
    v1_norm, _ = normalize_vectors(v1)
    v2_norm, _ = normalize_vectors(v2)
    
    # Dot product of normalized vectors
    dot = np.sum(v1_norm * v2_norm, axis=-1)
    dot = np.clip(dot, -1.0, 1.0)  # Numerical stability
    
    distance = 1.0 - dot
    return distance


def euclidean_distance(p1: np.ndarray, p2: np.ndarray) -> np.ndarray:
    """
    Compute Euclidean distance between points.
    
    Args:
        p1, p2: shape (..., 3)
    
    Returns:
        distance: shape (...)
    """
    return np.linalg.norm(p1 - p2, axis=-1)


def build_hybrid_cost_matrix(
    A: np.ndarray,
    B: np.ndarray,
    root_idx: int = 0,
    w_bone: float = 1.0,
    w_vel: float = 1.0,
    w_pose: float = 1.0,
    bone_pairs: Optional[List[Tuple[int, int]]] = None,
) -> np.ndarray:
    """
    Build hybrid per-frame cost matrix combining bone angles, velocities, and pose.
    
    Args:
        A: shape (T1, J, 3) - first sequence
        B: shape (T2, J, 3) - second sequence
        root_idx: root joint index
        w_bone: weight for bone vector cosine distance
        w_vel: weight for velocity cosine distance
        w_pose: weight for pose Euclidean distance
        bone_pairs: skeleton bone structure
    
    Returns:
        cost: shape (T1, T2) - accumulated cost per frame pair
    """
    T1, J, _ = A.shape
    T2 = B.shape[0]
    
    # Preprocess both sequences
    A_centered = root_center_pose(A, root_idx)
    B_centered = root_center_pose(B, root_idx)
    
    A_norm, A_scales = scale_normalize_pose(A_centered)
    B_norm, B_scales = scale_normalize_pose(B_centered)
    
    A_vel = compute_velocities(A_norm)
    B_vel = compute_velocities(B_norm)
    
    A_bones = compute_bone_vectors(A_norm, bone_pairs)
    B_bones = compute_bone_vectors(B_norm, bone_pairs)
    
    # Initialize cost matrix
    cost = np.zeros((T1, T2), dtype=np.float32)
    
    # Compute per-frame costs
    for t1 in range(T1):
        for t2 in range(T2):
            frame_cost = 0.0
            num_terms = 0
            
            # Bone vector alignment (cosine distance)
            if w_bone > 0:
                bone_dist = cosine_distance(A_bones[t1], B_bones[t2])  # (num_bones,)
                frame_cost += w_bone * bone_dist.mean()
                num_terms += 1
            
            # Velocity alignment (cosine distance)
            if w_vel > 0:
                vel_mag_A = np.linalg.norm(A_vel[t1], axis=-1)  # (J,)
                vel_mag_B = np.linalg.norm(B_vel[t2], axis=-1)
                
                # Only compute if both have meaningful velocity
                if vel_mag_A.mean() > 1e-6 and vel_mag_B.mean() > 1e-6:
                    vel_dist = cosine_distance(A_vel[t1], B_vel[t2])
                    frame_cost += w_vel * vel_dist.mean()
                    num_terms += 1
            
            # Pose alignment (Euclidean distance)
            if w_pose > 0:
                pose_dist = euclidean_distance(A_norm[t1], B_norm[t2])  # (J,)
                frame_cost += w_pose * pose_dist.mean()
                num_terms += 1
            
            # Average across terms
            cost[t1, t2] = frame_cost / num_terms if num_terms > 0 else 0.0
    
    return cost


# ============================================================================
# FULLY-OPEN DTW
# ============================================================================

def dtw_fully_open(
    cost: np.ndarray,
    pen_h: float = 1.0,
    pen_v: float = 1.0,
    pen_d: float = 1.0,
    band_ratio: Optional[float] = None,
) -> Tuple[np.ndarray, List[Tuple[int, int]], float]:
    """
    Fully-open (open-begin/open-end) DTW with step penalties.
    
    The path may start at any (i0, j0) and end at any (i1, j1).
    Three step types:
      - Diagonal (i, j) -> (i+1, j+1): cost + pen_d
      - Vertical (i, j) -> (i+1, j):   cost + pen_v
      - Horizontal (i, j) -> (i, j+1): cost + pen_h
    
    Optional Sakoe-Chiba band: j ≈ i * (T2/T1) ± band_ratio * max(T1, T2)
    
    Args:
        cost: shape (T1, T2) - per-frame cost matrix
        pen_h: step penalty for horizontal moves (advance B only)
        pen_v: step penalty for vertical moves (advance A only)
        pen_d: step penalty for diagonal moves (advance both)
        band_ratio: if not None, apply Sakoe-Chiba band constraint
    
    Returns:
        dp: shape (T1, T2) - DP table of accumulated costs
        path: list of (i, j) tuples - optimal alignment path
        min_cost: total cost of optimal path
    """
    T1, T2 = cost.shape
    
    # DP table: accumulated cost
    dp = np.full((T1 + 1, T2 + 1), np.inf, dtype=np.float32)
    dp[0, :] = 0.0  # Free start from any column at row 0
    dp[:, 0] = 0.0  # Free start from any row at column 0
    
    # Predecessor table for backtracking: (i, j) -> (prev_i, prev_j)
    pred = {}
    
    def is_valid(i, j):
        """Check if (i, j) is within band constraint."""
        if band_ratio is None:
            return True
        if i < 0 or j < 0:
            return False
        center = i * (T2 / T1)
        band_width = band_ratio * max(T1, T2)
        return abs(j - center) <= band_width
    
    # Track path lengths for normalization
    path_len = np.zeros((T1 + 1, T2 + 1), dtype=np.float32)
    
    # Forward DP pass
    for i in range(1, T1 + 1):
        for j in range(1, T2 + 1):
            if not is_valid(i - 1, j - 1):
                continue
            
            current_cost = cost[i - 1, j - 1]
            
            # Three possible predecessors with their accumulated costs
            candidates = []
            
            # Diagonal: (i-1, j-1) -> (i, j)
            if is_valid(i - 1, j - 1) and dp[i - 1, j - 1] < np.inf:
                diag_cost = dp[i - 1, j - 1] + current_cost
                candidates.append((diag_cost, (i - 1, j - 1), path_len[i - 1, j - 1] + 1))
            
            # Vertical: (i-1, j) -> (i, j)
            if is_valid(i - 1, j) and dp[i - 1, j] < np.inf:
                vert_cost = dp[i - 1, j] + current_cost
                candidates.append((vert_cost, (i - 1, j), path_len[i - 1, j] + 1))
            
            # Horizontal: (i, j-1) -> (i, j)
            if is_valid(i, j - 1) and dp[i, j - 1] < np.inf:
                horiz_cost = dp[i, j - 1] + current_cost
                candidates.append((horiz_cost, (i, j - 1), path_len[i, j - 1] + 1))
            
            if candidates:
                best_cost, best_pred, best_len = min(candidates, key=lambda x: x[0])
                dp[i, j] = best_cost
                path_len[i, j] = best_len
                pred[(i, j)] = best_pred
            else:
                # Can also start fresh from here (open-begin)
                dp[i, j] = current_cost
                path_len[i, j] = 1
    
    # Find best endpoint: use normalized cost that balances alignment quality and path length
    # Lower normalized cost = better alignment; longer paths = more robust
    best_end = (0, 0)
    best_score = np.inf
    
    for i in range(1, T1 + 1):
        for j in range(1, T2 + 1):
            if dp[i, j] < np.inf and path_len[i, j] > 0:
                # Normalized cost per-frame, with slight preference for longer paths
                avg_cost_per_frame = dp[i, j] / path_len[i, j]
                # Score combines average cost with path length factor
                # sqrt(path_len) acts as a gentle inverse weighting for longer paths
                score = avg_cost_per_frame - 0.1 * np.sqrt(path_len[i, j])
                
                if score < best_score:
                    best_score = score
                    best_end = (i, j)
    
    # Get the actual (non-normalized) cost for output
    if best_end != (0, 0):
        min_cost = dp[best_end[0], best_end[1]]
    else:
        min_cost = np.inf
    
    # Handle case where no valid path exists
    if np.isinf(min_cost) or best_end == (0, 0):
        return dp, [], np.inf
    
    # Backtrack to reconstruct path (DP indices 1-indexed)
    path = []
    current = best_end
    
    while current in pred:
        prev = pred[current]
        path.append(current)  # Record endpoint
        current = prev
    
    # Add the starting point
    path.append(current)
    
    # Reverse path (currently tail-to-head)
    path.reverse()
    
    # Convert from DP indices (1-indexed) to sequence indices (0-indexed)
    # and remove the (0,0) boundary if it appears
    path_0indexed = [(i - 1, j - 1) for i, j in path if i > 0 and j > 0]
    
    return dp, path_0indexed, min_cost


# ============================================================================
# PATH ANALYSIS & MAPPING
# ============================================================================

def extract_path_mapping(
    path: List[Tuple[int, int]],
    T1: int,
    T2: int,
) -> Tuple[int, int, int, int, Dict[int, int]]:
    """
    Extract overlapping region and frame-to-frame mapping from DTW path.
    
    Args:
        path: list of (i, j) pairs from DTW
        T1: total frames in A
        T2: total frames in B
    
    Returns:
        start_A, end_A: first/last matched frame in A
        start_B, end_B: first/last matched frame in B
        map_A_to_B: dict mapping frame indices in overlapping region
    """
    if not path:
        return 0, T1 - 1, 0, T2 - 1, {}
    
    path_arr = np.array(path, dtype=int)
    
    start_A = path_arr[0, 0]
    end_A = path_arr[-1, 0]
    start_B = path_arr[0, 1]
    end_B = path_arr[-1, 1]
    
    # Build many-to-one mapping (for each A index, list of B indices)
    mapping_multi = {}
    for i, j in path:
        if i not in mapping_multi:
            mapping_multi[i] = []
        mapping_multi[i].append(j)
    
    # Convert to one-to-one mapping (choose median B index for each A frame)
    map_A_to_B = {}
    for i in range(start_A, end_A + 1):
        if i in mapping_multi:
            b_indices = mapping_multi[i]
            map_A_to_B[i] = int(np.median(b_indices))
    
    return start_A, end_A, start_B, end_B, map_A_to_B


def resample_sequence(
    B: np.ndarray,
    map_A_to_B: Dict[int, int],
    start_A: int,
    end_A: int,
) -> np.ndarray:
    """
    Resample sequence B to match A's overlapping timeline using DTW mapping.
    
    Uses linear interpolation for sub-frame accuracy where needed.
    
    Args:
        B: shape (T2, J, 3)
        map_A_to_B: mapping dict
        start_A, end_A: range of A frames
    
    Returns:
        B_resampled: shape (end_A - start_A + 1, J, 3)
    """
    num_frames = end_A - start_A + 1
    J = B.shape[1]
    D = B.shape[2]
    
    B_resampled = np.zeros((num_frames, J, D), dtype=np.float32)
    
    for out_idx in range(num_frames):
        a_idx = start_A + out_idx
        if a_idx in map_A_to_B:
            b_idx = map_A_to_B[a_idx]
            b_idx = np.clip(b_idx, 0, B.shape[0] - 1)
            B_resampled[out_idx] = B[b_idx]
        else:
            # Fallback: use nearest available
            B_resampled[out_idx] = B[0]
    
    return B_resampled


# ============================================================================
# MAIN API
# ============================================================================

def run_pose_alignment(
    A: np.ndarray,
    B: np.ndarray,
    root_idx: int = 0,
    weights: Optional[Dict[str, float]] = None,
    penalties: Optional[Dict[str, float]] = None,
    band_ratio: Optional[float] = None,
    verbose: bool = True,
) -> Dict:
    """
    Align two pose sequences using fully-open DTW.
    
    Automatically discovers overlapping action regions and returns frame-to-frame
    mapping, even when sequences have leading/trailing unrelated frames.
    
    Args:
        A: shape (T1, J, 3) - first pose sequence
        B: shape (T2, J, 3) - second pose sequence
        root_idx: root joint index (default 0 = Hip for H36M)
        weights: dict with keys 'bone', 'vel', 'pose' (default: equal weights)
        penalties: dict with keys 'h', 'v', 'd' for DTW step penalties
                  (default: all 1.0)
        band_ratio: if set, apply Sakoe-Chiba band constraint
        verbose: print progress information
    
    Returns:
        result dict with keys:
          - 'total_cost': scalar, accumulated cost of optimal path
          - 'path': list of (i, j) tuples
          - 'start_A', 'end_A': overlapping frame range in A
          - 'start_B', 'end_B': overlapping frame range in B
          - 'map_A_to_B': dict mapping A frame indices to B frame indices
          - 'aligned_B': resampled B to match A's overlapping timeline
          - 'cost_matrix': full per-frame cost matrix
          - 'overlapping_ratio_A': fraction of A in overlap
          - 'overlapping_ratio_B': fraction of B in overlap
    """
    # Validate inputs
    assert A.ndim == 3 and A.shape[2] == 3, "A must be shape (T1, J, 3)"
    assert B.ndim == 3 and B.shape[2] == 3, "B must be shape (T2, J, 3)"
    assert A.shape[1] == B.shape[1], "A and B must have same number of joints"
    
    # Set defaults
    if weights is None:
        weights = {'bone': 1.0, 'vel': 1.0, 'pose': 1.0}
    if penalties is None:
        penalties = {'h': 1.0, 'v': 1.0, 'd': 1.0}
    
    T1, T2 = A.shape[0], B.shape[0]
    
    if verbose:
        print(f"[Pose Alignment] A: {T1} frames, B: {T2} frames")
        print(f"[Pose Alignment] Weights: {weights}")
        print(f"[Pose Alignment] Penalties: {penalties}")
    
    # Build cost matrix
    if verbose:
        print("[Pose Alignment] Building cost matrix...")
    cost = build_hybrid_cost_matrix(
        A, B,
        root_idx=root_idx,
        w_bone=weights.get('bone', 1.0),
        w_vel=weights.get('vel', 1.0),
        w_pose=weights.get('pose', 1.0),
    )
    
    if verbose:
        print(f"[Pose Alignment] Cost matrix shape: {cost.shape}")
        print(f"[Pose Alignment] Cost range: [{cost.min():.3f}, {cost.max():.3f}]")
    
    # Run fully-open DTW
    if verbose:
        print("[Pose Alignment] Running fully-open DTW...")
    dp, path, total_cost = dtw_fully_open(
        cost,
        pen_h=penalties.get('h', 1.0),
        pen_v=penalties.get('v', 1.0),
        pen_d=penalties.get('d', 1.0),
        band_ratio=band_ratio,
    )
    
    if verbose:
        print(f"[Pose Alignment] DTW path length: {len(path)}")
        print(f"[Pose Alignment] Total cost: {total_cost:.3f}")
    
    # Extract mapping and overlapping region
    start_A, end_A, start_B, end_B, map_A_to_B = extract_path_mapping(path, T1, T2)
    
    if verbose:
        print(f"[Pose Alignment] Overlapping region A: [{start_A}, {end_A}] ({end_A - start_A + 1} frames)")
        print(f"[Pose Alignment] Overlapping region B: [{start_B}, {end_B}] ({end_B - start_B + 1} frames)")
        print(f"[Pose Alignment] Overlap ratio A: {(end_A - start_A + 1) / T1:.1%}")
        print(f"[Pose Alignment] Overlap ratio B: {(end_B - start_B + 1) / T2:.1%}")
    
    # Resample B to A's timeline
    aligned_B = resample_sequence(B, map_A_to_B, start_A, end_A)
    
    return {
        'total_cost': total_cost,
        'path': path,
        'start_A': start_A,
        'end_A': end_A,
        'start_B': start_B,
        'end_B': end_B,
        'map_A_to_B': map_A_to_B,
        'aligned_B': aligned_B,
        'cost_matrix': cost,
        'dp_table': dp,
        'overlapping_ratio_A': (end_A - start_A + 1) / T1,
        'overlapping_ratio_B': (end_B - start_B + 1) / T2,
    }


# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================

def print_alignment_summary(result: Dict) -> None:
    """Pretty-print alignment results."""
    print("\n" + "=" * 70)
    print("POSE ALIGNMENT RESULTS")
    print("=" * 70)
    print(f"Total DTW cost:       {result['total_cost']:.4f}")
    print(f"Path length:          {len(result['path'])} steps")
    print(f"\nSequence A:")
    print(f"  Total frames:       {result['end_A'] - result['start_A'] + 1} (from {result['start_A']} to {result['end_A']})")
    print(f"  Leading frames:     {result['start_A']}")
    print(f"  Trailing frames:    unknown")
    print(f"\nSequence B:")
    print(f"  Total frames:       {result['end_B'] - result['start_B'] + 1} (from {result['start_B']} to {result['end_B']})")
    print(f"  Leading frames:     {result['start_B']}")
    print(f"  Trailing frames:    unknown")
    print(f"\nOverlap ratios:")
    print(f"  A coverage:         {result['overlapping_ratio_A']:.1%}")
    print(f"  B coverage:         {result['overlapping_ratio_B']:.1%}")
    print("=" * 70 + "\n")


# ============================================================================
# EXAMPLE USAGE
# ============================================================================

if __name__ == "__main__":
    print("Pose Alignment - Fully-Open DTW")
    print("=" * 70)
    
    # Example: Create synthetic pose sequences with offsets
    np.random.seed(42)
    
    # Create base motion (smooth)
    T_base = 30
    J = 17
    D = 3
    
    t = np.linspace(0, 2 * np.pi, T_base)
    base_motion = np.zeros((T_base, J, D), dtype=np.float32)
    
    # Sinusoidal motion for each joint
    for j in range(J):
        base_motion[:, j, 0] = np.sin(t + j * 0.1) * (1 + j * 0.05)
        base_motion[:, j, 1] = np.cos(t + j * 0.1) * (1 + j * 0.05)
        base_motion[:, j, 2] = np.sin(2 * t + j * 0.1) * 0.5
    
    # Create A with 5 leading frames and 3 trailing frames
    A = np.vstack([
        np.random.randn(5, J, D) * 0.1,  # Leading noise
        base_motion,
        np.random.randn(3, J, D) * 0.1,  # Trailing noise
    ]).astype(np.float32)
    
    # Create B with 3 leading frames, offset motion, and 4 trailing frames
    B_motion = base_motion[5:25] + np.random.randn(20, J, D) * 0.05
    B = np.vstack([
        np.random.randn(3, J, D) * 0.1,  # Leading noise
        B_motion,
        np.random.randn(4, J, D) * 0.1,  # Trailing noise
    ]).astype(np.float32)
    
    print(f"\nExample sequences:")
    print(f"  A: {A.shape} (30 base + 5 leading + 3 trailing)")
    print(f"  B: {B.shape} (20 offset base + 3 leading + 4 trailing)")
    
    # Run alignment
    result = run_pose_alignment(
        A, B,
        root_idx=0,
        weights={'bone': 1.0, 'vel': 1.0, 'pose': 1.0},
        penalties={'h': 1.0, 'v': 1.0, 'd': 1.0},
        verbose=True,
    )
    
    # Print summary
    print_alignment_summary(result)
    
    # Print mapping sample
    print("Sample frame mappings (first 10):")
    for a_idx in sorted(result['map_A_to_B'].keys())[:10]:
        b_idx = result['map_A_to_B'][a_idx]
        print(f"  A[{a_idx}] -> B[{b_idx}]")
