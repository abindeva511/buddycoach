import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { colors } from "../theme/colors";

export default function ProcessingScreen() {
  return (
    <View style={styles.container}>
      <View style={styles.content}>
        {/* Animated Circle */}
        <View style={styles.loaderContainer}>
          <View style={styles.outerRing} />
          <View style={styles.middleRing} />
          <ActivityIndicator size="large" color={colors.primary} style={styles.spinner} />
        </View>

        <Text style={styles.emoji}>🤖</Text>
        
        <Text style={styles.title}>Analyzing Your Form</Text>
        
        <Text style={styles.subtitle}>
          Our AI is reviewing your video frame by frame
        </Text>

        {/* Progress Steps */}
        <View style={styles.stepsContainer}>
          <View style={styles.step}>
            <Text style={styles.stepIcon}>✓</Text>
            <Text style={styles.stepText}>Video uploaded</Text>
          </View>
          <View style={styles.step}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.stepText}>Detecting poses...</Text>
          </View>
          <View style={[styles.step, styles.stepPending]}>
            <Text style={styles.stepIconPending}>○</Text>
            <Text style={styles.stepTextPending}>Generating feedback</Text>
          </View>
        </View>

        <Text style={styles.timeNote}>
          This usually takes about a minute ⏱️
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: "center",
    alignItems: "center",
  },
  content: {
    alignItems: "center",
    padding: 24,
  },
  loaderContainer: {
    width: 120,
    height: 120,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 24,
  },
  outerRing: {
    position: "absolute",
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 3,
    borderColor: colors.backgroundCard,
  },
  middleRing: {
    position: "absolute",
    width: 90,
    height: 90,
    borderRadius: 45,
    borderWidth: 2,
    borderColor: colors.border,
  },
  spinner: {
    transform: [{ scale: 1.5 }],
  },
  emoji: {
    fontSize: 48,
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: colors.textPrimary,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: "center",
    marginBottom: 32,
  },
  stepsContainer: {
    width: "100%",
    backgroundColor: colors.backgroundCard,
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
  },
  step: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  stepIcon: {
    fontSize: 16,
    color: colors.success,
    marginRight: 12,
    width: 20,
    textAlign: "center",
  },
  stepIconPending: {
    fontSize: 16,
    color: colors.textMuted,
    marginRight: 12,
    width: 20,
    textAlign: "center",
  },
  stepText: {
    fontSize: 14,
    color: colors.textPrimary,
  },
  stepPending: {
    marginBottom: 0,
  },
  stepTextPending: {
    fontSize: 14,
    color: colors.textMuted,
  },
  timeNote: {
    fontSize: 14,
    color: colors.textSecondary,
  },
});
