import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";
import { getRefreshToken, deleteRefreshToken } from "./storage";
import { Platform } from "react-native";
import Constants from "expo-constants";

// EC2 backend URL — update this when the EC2 IP changes
const EC2_URL = "http://13.219.227.121:8000";

const getBaseUrl = () => {
  const USE_EC2 = false;
  if (USE_EC2) return EC2_URL;

  // On a physical device, localhost won't reach your Mac.
  // Expo exposes the dev server host — reuse that IP for the backend.
  const debuggerHost =
    Constants.expoConfig?.hostUri ??          // SDK 46+
    (Constants.manifest2 as any)?.extra?.expoGo?.debuggerHost ?? // older SDK
    (Constants.manifest as any)?.debuggerHost; // SDK 45 and below

  if (debuggerHost) {
    const ip = debuggerHost.split(":")[0];    // strip port
    return `http://${ip}:8000`;
  }

  // Fallback — web browser / simulator on same machine
  return "http://localhost:8000";
};

const BASE_URL = getBaseUrl();

const api = axios.create({
  baseURL: BASE_URL,
});

let accessToken: string | null = null;
let isRefreshing = false;
let subscribers: ((token: string) => void)[] = [];

export const setAccessToken = (token: string | null) => {
  accessToken = token;
};

const onRefreshed = (token: string) => {
  subscribers.forEach((cb) => cb(token));
  subscribers = [];
};

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;

      if (isRefreshing) {
        return new Promise((resolve) => {
          subscribers.push((token) => {
            original.headers.Authorization = `Bearer ${token}`;
            resolve(api(original));
          });
        });
      }

      isRefreshing = true;

      try {
        const refreshToken = await getRefreshToken();
        if (!refreshToken) throw new Error("No refresh token");

        const res = await axios.post(`${BASE_URL}/api/v1/auth/refresh-token`, {
          refresh_token: refreshToken,
        });

        const newToken: string = res.data.access_token;
        setAccessToken(newToken);

        onRefreshed(newToken);
        isRefreshing = false;

        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      } catch (err) {
        isRefreshing = false;
        await deleteRefreshToken();
        return Promise.reject(err);
      }
    }

    return Promise.reject(error);
  }
);

// Exercise API types
export interface MuscleGroupAPI {
  id: number;
  name: string;
  icon: string;
  exerciseCount: number;
}

export interface ExerciseSearchResult {
  id: number;
  exercise_name: string;
  muscle_name: string | null;
  equipment_type: string | null;
  muscle_group_name: string | null;
}

export interface ExerciseAPI {
  id: number;
  muscle_group_id: number | null;
  muscle_name: string | null;
  equipment_type: string | null;
  exercise_name: string;
  exercise_url: string | null;
  video_url: string | null;
  video_path: string | null;
  has_video: boolean;
}

// Exercise API functions
export const exerciseApi = {
  getMuscleGroups: async (): Promise<MuscleGroupAPI[]> => {
    const response = await api.get('/api/v1/exercises/muscle-groups');
    return response.data;
  },

  searchExercises: async (query: string, limit: number = 10): Promise<ExerciseSearchResult[]> => {
    const response = await api.get('/api/v1/exercises/search', {
      params: { q: query, limit }
    });
    return response.data;
  },

  getExercisesByMuscle: async (muscleGroupId: number, skip: number = 0, limit: number = 50): Promise<ExerciseAPI[]> => {
    const response = await api.get(`/api/v1/exercises/by-muscle/${muscleGroupId}`, {
      params: { skip, limit }
    });
    return response.data;
  },

  getExercise: async (exerciseId: number): Promise<ExerciseAPI> => {
    const response = await api.get(`/api/v1/exercises/${exerciseId}`);
    return response.data;
  },

  getVideoUrl: (exerciseId: number): string => {
    return `${BASE_URL}/api/v1/exercises/${exerciseId}/video`;
  },
};

export default api;