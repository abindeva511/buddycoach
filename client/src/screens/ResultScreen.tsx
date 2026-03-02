import React from "react";
import {
  View,
  ScrollView,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from "react-native";
import api from "../api/api";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../navigation/types";
import { colors, shadows } from "../theme/colors";

type Props = NativeStackScreenProps<RootStackParamList, "Result">;

export default function ResultScreen({ route, navigation }: Props) {
  const { result } = route.params;

  // Calculate a simple score based on result (placeholder logic)
  const score = Math.floor(Math.random() * 20) + 80; // 80-100 for demo

  const downloadNpy = async () => {
    if (!result.download_url) return;
    try {
      // Fetch the file via the authenticated Axios instance (includes Bearer token)
      const response = await api.get(result.download_url, {
        responseType: 'blob',
      });
      const blob = new Blob([response.data], { type: 'application/octet-stream' });
      if (Platform.OS === 'web') {
        // Trigger browser file-save dialog
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `pose3d_${result.analysis_id ?? 'result'}.npz`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (e: any) {
      console.error('Download failed:', e.message);
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Analysis Complete</Text>
        <Text style={styles.headerEmoji}>🎉</Text>
      </View>

      <ScrollView 
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
      >
        {/* Score Card */}
        <View style={styles.scoreCard}>
          <View style={styles.scoreCircle}>
            <Text style={styles.scoreValue}>{score}</Text>
            <Text style={styles.scoreLabel}>Score</Text>
          </View>
          <View style={styles.scoreInfo}>
            <Text style={styles.scoreTitle}>Great Job! 🏆</Text>
            <Text style={styles.scoreSubtitle}>
              Your form is looking good
            </Text>
          </View>
        </View>

        {/* Stats */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statEmoji}>⏱️</Text>
            <Text style={styles.statValue}>{result.processing_time_seconds}s</Text>
            <Text style={styles.statLabel}>Analysis Time</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statEmoji}>📊</Text>
            <Text style={styles.statValue}>{result.analysis_type || "Full"}</Text>
            <Text style={styles.statLabel}>Type</Text>
          </View>
        </View>

        {/* Feedback */}
        <View style={styles.feedbackCard}>
          <View style={styles.feedbackHeader}>
            <Text style={styles.feedbackIcon}>📝</Text>
            <Text style={styles.feedbackTitle}>AI Feedback</Text>
          </View>
          <Text style={styles.feedbackText}>
            {result.result || "Analysis completed successfully. Your form shows good technique with room for minor improvements."}
          </Text>
        </View>

        {/* Tips Card */}
        <View style={styles.tipsCard}>
          <Text style={styles.tipsTitle}>💡 Tips to Improve</Text>
          <View style={styles.tipItem}>
            <Text style={styles.tipBullet}>•</Text>
            <Text style={styles.tipText}>Focus on controlled movements</Text>
          </View>
          <View style={styles.tipItem}>
            <Text style={styles.tipBullet}>•</Text>
            <Text style={styles.tipText}>Maintain proper breathing rhythm</Text>
          </View>
          <View style={styles.tipItem}>
            <Text style={styles.tipBullet}>•</Text>
            <Text style={styles.tipText}>Keep practicing regularly</Text>
          </View>
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          {/* Download 3D pose data if available */}
          {result.download_url && (
            <TouchableOpacity
              style={styles.downloadButton}
              onPress={downloadNpy}
            >
              <Text style={styles.downloadButtonIcon}>⬇️</Text>
              <Text style={styles.downloadButtonText}>Download 3D Pose Data (.npz)</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => navigation.navigate("Home")}
          >
            <Text style={styles.primaryButtonIcon}>🏠</Text>
            <Text style={styles.primaryButtonText}>Back to Home</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.secondaryButtonText}>Try Another Video</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 60,
    paddingBottom: 20,
    backgroundColor: colors.backgroundLight,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: "bold",
    color: colors.textPrimary,
    marginRight: 8,
  },
  headerEmoji: {
    fontSize: 24,
  },
  scrollView: {
    flex: 1,
    padding: 20,
  },
  scoreCard: {
    flexDirection: "row",
    backgroundColor: colors.backgroundCard,
    borderRadius: 24,
    padding: 24,
    alignItems: "center",
    marginBottom: 16,
    ...shadows.card,
  },
  scoreCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primary,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 20,
  },
  scoreValue: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#fff",
  },
  scoreLabel: {
    fontSize: 10,
    color: "rgba(255,255,255,0.8)",
  },
  scoreInfo: {
    flex: 1,
  },
  scoreTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: colors.textPrimary,
    marginBottom: 4,
  },
  scoreSubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  statsRow: {
    flexDirection: "row",
    marginBottom: 16,
    gap: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.backgroundCard,
    borderRadius: 16,
    padding: 16,
    alignItems: "center",
  },
  statEmoji: {
    fontSize: 24,
    marginBottom: 8,
  },
  statValue: {
    fontSize: 18,
    fontWeight: "bold",
    color: colors.textPrimary,
  },
  statLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 4,
  },
  feedbackCard: {
    backgroundColor: colors.backgroundCard,
    borderRadius: 20,
    padding: 20,
    marginBottom: 16,
  },
  feedbackHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  feedbackIcon: {
    fontSize: 20,
    marginRight: 8,
  },
  feedbackTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: colors.textPrimary,
  },
  feedbackText: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  tipsCard: {
    backgroundColor: colors.backgroundCard,
    borderRadius: 20,
    padding: 20,
    marginBottom: 24,
    borderLeftWidth: 4,
    borderLeftColor: colors.success,
  },
  tipsTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: colors.textPrimary,
    marginBottom: 12,
  },
  tipItem: {
    flexDirection: "row",
    marginBottom: 8,
  },
  tipBullet: {
    color: colors.success,
    marginRight: 8,
    fontSize: 16,
  },
  tipText: {
    fontSize: 14,
    color: colors.textSecondary,
    flex: 1,
  },
  actions: {
    marginBottom: 40,
  },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    paddingVertical: 18,
    borderRadius: 16,
    marginBottom: 12,
    ...shadows.button,
  },
  primaryButtonIcon: {
    fontSize: 20,
    marginRight: 8,
  },
  primaryButtonText: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#fff",
  },
  secondaryButton: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.backgroundCard,
    paddingVertical: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.textSecondary,
  },
  downloadButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1a1a2e",
    paddingVertical: 18,
    borderRadius: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  downloadButtonIcon: {
    fontSize: 20,
    marginRight: 8,
  },
  downloadButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.primary,
  },
});
