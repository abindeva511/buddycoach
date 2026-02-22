import React, { useContext } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { AuthContext } from "../context/AuthContext";
import { RootStackParamList } from "./types";

import LoginScreen from "../screens/LoginScreen";
import RegisterScreen from "../screens/RegisterScreen";
import HomeScreen from "../screens/HomeScreen";
import UploadScreen from "../screens/UploadScreen";
import ProcessingScreen from "../screens/ProcessingScreen";
import ResultScreen from "../screens/ResultScreen";

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function Navigation() {
  const { user, loading } = useContext(AuthContext);

  if (loading) return null;

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!user ? (
          <>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Register" component={RegisterScreen} />
          </>
        ) : (
          <>
            <Stack.Screen name="Home" component={HomeScreen} />
            <Stack.Screen name="Upload" component={UploadScreen} />
            <Stack.Screen name="Processing" component={ProcessingScreen} />
            <Stack.Screen name="Result" component={ResultScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}