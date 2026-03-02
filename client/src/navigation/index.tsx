import React, { useContext } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createDrawerNavigator } from "@react-navigation/drawer";
import { AuthContext } from "../context/AuthContext";
import { RootStackParamList, DrawerParamList } from "./types";
import { colors } from "../theme/forgefit";
import CustomDrawer from "../components/CustomDrawer";

import LoginScreen from "../screens/LoginScreen";
import RegisterScreen from "../screens/RegisterScreen";
import HomeScreen from "../screens/HomeScreen";
import UploadScreen from "../screens/UploadScreen";
import ProcessingScreen from "../screens/ProcessingScreen";
import ResultScreen from "../screens/ResultScreen";
// ForgeFit screens
import ForgeFitHomeScreen from "../screens/ForgeFitHomeScreen";
import ExerciseListScreen from "../screens/ExerciseListScreen";
import ExerciseDetailScreen from "../screens/ExerciseDetailScreen";

const Stack = createNativeStackNavigator<RootStackParamList>();
const Drawer = createDrawerNavigator<DrawerParamList>();

function MainDrawer() {
  return (
    <Drawer.Navigator
      drawerContent={(props) => <CustomDrawer {...props} />}
      screenOptions={{
        headerShown: false,
        drawerStyle: {
          backgroundColor: colors.bg,
          width: 320,
        },
        drawerActiveBackgroundColor: colors.tagBg,
        drawerActiveTintColor: colors.accent,
        drawerInactiveTintColor: colors.text,
        drawerLabelStyle: {
          fontSize: 14,
          fontWeight: '600',
          marginLeft: -10,
        },
      }}
    >
      <Drawer.Screen 
        name="HomeDrawer" 
        component={ForgeFitHomeScreen}
        options={{
          drawerLabel: '🏠  Home',
          title: 'Home',
        }}
      />
      <Drawer.Screen 
        name="PlansDrawer" 
        component={ForgeFitHomeScreen}
        options={{
          drawerLabel: '📋  My Plans',
          title: 'Plans',
        }}
      />
      <Drawer.Screen 
        name="StatsDrawer" 
        component={ForgeFitHomeScreen}
        options={{
          drawerLabel: '📊  Statistics',
          title: 'Statistics',
        }}
      />
      <Drawer.Screen 
        name="HistoryDrawer" 
        component={ForgeFitHomeScreen}
        options={{
          drawerLabel: '📜  Workout History',
          title: 'History',
        }}
      />
      <Drawer.Screen 
        name="FavoritesDrawer" 
        component={ForgeFitHomeScreen}
        options={{
          drawerLabel: '❤️  Favorites',
          title: 'Favorites',
        }}
      />
    </Drawer.Navigator>
  );
}

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
            {/* Main app with drawer */}
            <Stack.Screen name="ForgeFitHome" component={MainDrawer} />
            <Stack.Screen name="ExerciseList" component={ExerciseListScreen} />
            <Stack.Screen name="ExerciseDetail" component={ExerciseDetailScreen} />
            {/* Legacy screens */}
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