import type { MuscleGroup } from '../types/fitness';
import type { ExerciseAPI } from '../api/api';

export type RootStackParamList = {
  Login: undefined;
  Register: undefined;
  Home: undefined;
  Upload: { workout: string };
  Processing: undefined;
  Result: { result: AnalysisResponse };
  // ForgeFit screens
  MainDrawer: undefined;
  ForgeFitHome: undefined;
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
}