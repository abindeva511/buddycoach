import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";
import { getRefreshToken, deleteRefreshToken } from "./storage";

const BASE_URL = "http://54.159.33.72/";

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

export default api;