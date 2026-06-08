import type { MuscleGroup } from '../types/fitness';
import type { ExerciseAPI } from '../api/api';

export type RootStackParamList = {
  Login: undefined;
  Register: undefined;
  Main: undefined;
  Home: undefined;
  Upload: { workout: string };
  Processing: undefined;
  Result: { result: AnalysisResponse; exercise?: ExerciseAPI };
  ExerciseList: { muscleGroup: MuscleGroup };
  ExerciseDetail: { exercise: ExerciseAPI };
  VideoReview: { videoUri: string; videoFile?: File | null; exercise: ExerciseAPI };
};

export type DrawerParamList = {
  HomeDrawer: undefined;
  PlansDrawer: undefined;
  StatsDrawer: undefined;
  HistoryDrawer: undefined;
  FavoritesDrawer: undefined;
};

/** One frame of the DTW-aligned comparison */
export interface ComparisonFrame {
  idx: number;
  user_frame_no: number;
  ref_frame_no: number;
  user_image: string;   // data:image/jpeg;base64,...
  ref_image: string;
  right_knee_you: number;
  right_knee_ref: number;
  left_knee_you: number;
  left_knee_ref: number;
  right_hip_you: number;
  right_hip_ref: number;
  left_hip_you: number;
  left_hip_ref: number;
  spine_coaching: string;
}

/** Full comparison payload returned by /api/v1/analysis/compare */
export interface ComparisonResult {
  dtw_cost: number;
  n_matched_frames: number;
  frames: ComparisonFrame[];
}

export interface AnalysisResponse {
  analysis_id: string;
  processing_time_seconds: number;
  result?: string;
  analysis_type?: string;
  download_url?: string;         // pose .npz for user video
  video_available?: boolean;
  video_download_url?: string | null;
  // Reference video analysis (when exercise context is present)
  reference_analysis_id?: string;
  reference_download_url?: string;
  reference_video_available?: boolean;
  reference_video_download_url?: string | null;
  // Frame-by-frame comparison (populated after /compare call)
  comparison?: ComparisonResult;
}