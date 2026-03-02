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
  ForgeFitHome: undefined;
  ExerciseList: { muscleGroup: MuscleGroup };
  ExerciseDetail: { exercise: ExerciseAPI };
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
  download_url?: string;  // present for pose3d analyses
}