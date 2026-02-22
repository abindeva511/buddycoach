export type RootStackParamList = {
  Login: undefined;
  Register: undefined;
  Home: undefined;
  Upload: { workout: string };
  Processing: undefined;
  Result: { result: AnalysisResponse };
};

export interface AnalysisResponse {
  analysis_id: string;
  processing_time_seconds: number;
  result: string;
}