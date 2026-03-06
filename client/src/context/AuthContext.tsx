import React, { createContext, useState, useEffect, ReactNode } from "react";
import api, { setAccessToken } from "../api/api";
import { saveRefreshToken, getRefreshToken, deleteRefreshToken } from "../api/storage";

interface AuthContextType {
  user: boolean;
  loading: boolean;
  login: (u: string, p: string) => Promise<void>;
  register: (u: string, p: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      console.log('AuthProvider: forcing logout');
      await logout(); // Properly await token deletion
      setLoading(false);
    })();
  }, []);

  const init = async () => {
    const refresh = await getRefreshToken();
    if (refresh) {
      try {
        const res = await api.post("/api/v1/auth/refresh-token", {
          refresh_token: refresh,
        });
        setAccessToken(res.data.access_token);
        setUser(true);
      } catch {
        await deleteRefreshToken();
      }
    }
    setLoading(false);
  };

  const login = async (username: string, password: string) => {
    const payload = new URLSearchParams({
      grant_type: "password",
      username,
      password,
    });

    const res = await api.post("/api/v1/auth/login", payload, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    setAccessToken(res.data.access_token);
    await saveRefreshToken(res.data.refresh_token);
    setUser(true);
  };

  const register = async (username: string, password: string) => {
    const payload = new URLSearchParams({
      grant_type: "password",
      username,
      password,
    });

    await api.post("/api/v1/auth/register", payload, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
  };

  const logout = async () => {
    setUser(false);
    setAccessToken(null);
    await deleteRefreshToken();
  };

  return (
    <AuthContext.Provider value={{ user, login, register, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
};
