import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const isWeb = Platform.OS === "web";

export const saveRefreshToken = async (token: string) => {
  if (isWeb) {
    localStorage.setItem("refreshToken", token);
  } else {
    await SecureStore.setItemAsync("refreshToken", token);
  }
};

export const getRefreshToken = async (): Promise<string | null> => {
  if (isWeb) {
    return localStorage.getItem("refreshToken");
  } else {
    return await SecureStore.getItemAsync("refreshToken");
  }
};

export const deleteRefreshToken = async () => {
  if (isWeb) {
    localStorage.removeItem("refreshToken");
  } else {
    await SecureStore.deleteItemAsync("refreshToken");
  }
};