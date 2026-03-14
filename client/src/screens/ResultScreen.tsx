import React, { useState, useEffect } from "react";
import {
  View,
  ScrollView,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
} from "react-native";
import { Video, ResizeMode } from "expo-av";
import api from "../api/api";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../navigation/types";
import { colors, shadows } from "../theme/colors";

type Props = NativeStackScreenProps<RootStackParamList, "Result">;

export default function ResultScreen({ route, navigation }: Props) {
  const { result } = route.params;
  const [isLoadingVideo, setIsLoadingVideo] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isLoadingRefVideo, setIsLoadingRefVideo] = useState(false);
  const [refVideoUrl, setRefVideoUrl] = useState<string | null>(null);

  // Calculate a simple score based on result (placeholder logic)
  const score = Math.floor(Math.random() * 20) + 80; // 80-100 for demo

  // Support both old and new API response formats
  const poseDownloadUrl = result.pose_download_url || result.download_url;
  const videoDownloadUrl = result.video_download_url;
  const videoAvailable = videoDownloadUrl != null;
  const refVideoDownloadUrl = result.reference_video_download_url;
  const refVideoAvailable = refVideoDownloadUrl != null;
  const refPoseDownloadUrl = result.reference_download_url;

  // Debug: log what the backend returned
  console.log('[ResultScreen] result keys:', JSON.stringify({
    analysis_id: result.analysis_id,
    download_url: result.download_url,
    video_available: result.video_available,
    video_download_url: result.video_download_url,
    reference_analysis_id: result.reference_analysis_id,
    reference_download_url: result.reference_download_url,
    reference_video_available: result.reference_video_available,
    reference_video_download_url: result.reference_video_download_url,
  }));

  const downloadFile = async (downloadUrl: string, filename: string) => {
    if (!downloadUrl) return;
    try {
      // Fetch the file via the authenticated Axios instance (includes Bearer token)
      const response = await api.get(downloadUrl, {
        responseType: 'blob',
      });
      if (Platform.OS === 'web') {
        // Trigger browser file-save dialog
        const blob = new Blob([response.data], { 
          type: filename.endsWith('.mp4') ? 'video/mp4' : 'application/octet-stream' 
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (e: any) {
      console.error('Download failed:', e.message);
    }
  };

  // Load preview of rendered video
  const loadVideoPreview = async () => {
    if (!videoDownloadUrl) return;
    try {
      setIsLoadingVideo(true);
      const response = await api.get(videoDownloadUrl, {
        responseType: 'blob',
      });
      const blob = new Blob([response.data], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);
      setVideoUrl(url);
    } catch (e: any) {
      console.error('Failed to load video preview:', e.message);
    } finally {
      setIsLoadingVideo(false);
    }
  };

  const loadRefVideoPreview = async () => {
    if (!refVideoDownloadUrl) return;
    try {
      setIsLoadingRefVideo(true);
      const response = await api.get(refVideoDownloadUrl, { responseType: 'blob' });
      const blob = new Blob([response.data], { type: 'video/mp4' });
      setRefVideoUrl(URL.createObjectURL(blob));
    } catch (e: any) {
      console.error('Failed to load reference video preview:', e.message);
    } finally {
      setIsLoadingRefVideo(false);
    }
  };

  // Auto-load video preview when component mounts
  useEffect(() => {
    if (videoAvailable && videoDownloadUrl) {
      loadVideoPreview();
    }
  }, [videoAvailable, videoDownloadUrl]);

  useEffect(() => {
    if (refVideoAvailable && refVideoDownloadUrl) {
      loadRefVideoPreview();
    }
  }, [refVideoAvailable, refVideoDownloadUrl]);

  const downloadNpy = async () => {
    await downloadFile(poseDownloadUrl, `pose3d_${result.analysis_id ?? 'result'}.npz`);
  };

  const downloadVideo = async () => {
    await downloadFile(videoDownloadUrl, `pose_visualization_${result.analysis_id ?? 'result'}.mp4`);
  };

  const downloadRefVideo = async () => {
    await downloadFile(refVideoDownloadUrl!, `reference_pose_${result.reference_analysis_id ?? 'ref'}.mp4`);
  };

  const downloadRefNpy = async () => {
    await downloadFile(refPoseDownloadUrl!, `pose3d_reference_${result.reference_analysis_id ?? 'ref'}.npz`);
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
        {/* Your Video Preview Section */}
        {videoAvailable && (
          <View style={styles.videoPreviewSection}>
            <Text style={styles.videoPreviewTitle}>📹 Your Pose Analysis</Text>
            {videoUrl ? (
              <View style={styles.videoContainer}>
                <Video
                  source={{ uri: videoUrl }}
                  style={styles.videoPlayer}
                  resizeMode={ResizeMode.CONTAIN}
                  useNativeControls
                  isLooping={false}
                />
              </View>
            ) : (
              <TouchableOpacity 
                style={styles.loadVideoButton}
                onPress={loadVideoPreview}
                disabled={isLoadingVideo}
              >
                {isLoadingVideo ? (
                  <ActivityIndicator color={colors.primary} />
                ) : (
                  <>
                    <Text style={styles.loadVideoIcon}>🎬</Text>
                    <Text style={styles.loadVideoText}>Load Video Preview</Text>
                  </>
                )}
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Reference Video Preview Section */}
        {refVideoAvailable && (
          <View style={[styles.videoPreviewSection, { borderLeftWidth: 4, borderLeftColor: '#00cc88' }]}>
            <Text style={styles.videoPreviewTitle}>🎯 Reference Pose Analysis</Text>
            {refVideoUrl ? (
              <View style={styles.videoContainer}>
                <Video
                  source={{ uri: refVideoUrl }}
                  style={styles.videoPlayer}
                  resizeMode={ResizeMode.CONTAIN}
                  useNativeControls
                  isLooping={false}
                />
              </View>
            ) : (
              <TouchableOpacity 
                style={styles.loadVideoButton}
                onPress={loadRefVideoPreview}
                disabled={isLoadingRefVideo}
              >
                {isLoadingRefVideo ? (
                  <ActivityIndicator color={colors.primary} />
                ) : (
                  <>
                    <Text style={styles.loadVideoIcon}>🎬</Text>
                    <Text style={styles.loadVideoText}>Load Reference Preview</Text>
                  </>
                )}
              </TouchableOpacity>
            )}
          </View>
        )}
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
          {/* Download Rendered Video with Pose Overlay */}
          {videoAvailable && videoDownloadUrl && (
            <TouchableOpacity
              style={styles.downloadButtonVideo}
              onPress={downloadVideo}
            >
              <Text style={styles.downloadButtonIcon}>🎬</Text>
              <Text style={styles.downloadButtonVideoText}>Download Your Pose Video (.mp4)</Text>
            </TouchableOpacity>
          )}

          {/* Download Reference Pose Video */}
          {refVideoAvailable && refVideoDownloadUrl && (
            <TouchableOpacity
              style={[styles.downloadButtonVideo, { borderColor: '#00cc88', backgroundColor: '#0a2e20' }]}
              onPress={downloadRefVideo}
            >
              <Text style={styles.downloadButtonIcon}>🎯</Text>
              <Text style={styles.downloadButtonVideoText}>Download Reference Pose Video (.mp4)</Text>
            </TouchableOpacity>
          )}

          {/* Download 3D pose data if available */}
          {poseDownloadUrl && (
            <TouchableOpacity
              style={styles.downloadButton}
              onPress={downloadNpy}
            >
              <Text style={styles.downloadButtonIcon}>📊</Text>
              <Text style={styles.downloadButtonText}>Download Your 3D Pose Data (.npz)</Text>
            </TouchableOpacity>
          )}

          {/* Download Reference 3D pose data */}
          {refPoseDownloadUrl && (
            <TouchableOpacity
              style={[styles.downloadButton, { borderColor: '#00cc88', backgroundColor: '#0a2e20' }]}
              onPress={downloadRefNpy}
            >
              <Text style={styles.downloadButtonIcon}>🎯</Text>
              <Text style={styles.downloadButtonText}>Download Reference 3D Pose Data (.npz)</Text>
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
  downloadButtonVideo: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1a2e2e",
    paddingVertical: 18,
    borderRadius: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#00cc88",
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
  downloadButtonVideoText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#00cc88",
  },
  videoPreviewSection: {
    backgroundColor: colors.backgroundCard,
    borderRadius: 20,
    padding: 20,
    marginBottom: 24,
    overflow: "hidden",
  },
  videoPreviewTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: colors.textPrimary,
    marginBottom: 16,
  },
  videoContainer: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: "#000",
    borderRadius: 12,
    overflow: "hidden",
    marginBottom: 12,
  },
  videoPlayer: {
    width: "100%",
    height: "100%",
  },
  loadVideoButton: {
    width: "100%",
    paddingVertical: 24,
    paddingHorizontal: 16,
    backgroundColor: colors.backgroundLight,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.border,
    borderStyle: "dashed",
  },
  loadVideoIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  loadVideoText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.primary,
  },
});
