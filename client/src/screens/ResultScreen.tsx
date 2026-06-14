import React, { useState, useEffect } from "react";
import {
  View,
  ScrollView,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
  Image,
} from "react-native";
import { Video, ResizeMode } from "expo-av";
import api, { getAccessToken } from "../api/api";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList, ComparisonFrame } from "../navigation/types";
import { colors, shadows } from "../theme/colors";

type Props = NativeStackScreenProps<RootStackParamList, "Result">;

// ─── Frame card shown in the comparison section ───────────────────────────────
function FrameCard({ frame, index }: { frame: ComparisonFrame; index: number }) {
  const angleRows = [
    { joint: 'Right Knee', you: frame.right_knee_you, ref: frame.right_knee_ref },
    { joint: 'Left Knee',  you: frame.left_knee_you,  ref: frame.left_knee_ref  },
    { joint: 'Right Hip',  you: frame.right_hip_you,  ref: frame.right_hip_ref  },
    { joint: 'Left Hip',   you: frame.left_hip_you,   ref: frame.left_hip_ref   },
  ];
  return (
    <View style={frameStyles.card}>
      <Text style={frameStyles.cardTitle}>Frame {index + 1}  (you #{frame.user_frame_no} · ref #{frame.ref_frame_no})</Text>
      {/* Side-by-side images */}
      <View style={frameStyles.imageRow}>
        <View style={frameStyles.imageBox}>
          <Text style={[frameStyles.imageLabel, { color: '#4d9fff' }]}>YOU</Text>
          <Image
            source={{ uri: frame.user_image }}
            style={frameStyles.image}
            resizeMode="contain"
          />
        </View>
        <View style={frameStyles.imageBox}>
          <Text style={[frameStyles.imageLabel, { color: '#ff6b6b' }]}>REF</Text>
          <Image
            source={{ uri: frame.ref_image }}
            style={frameStyles.image}
            resizeMode="contain"
          />
        </View>
      </View>
      {/* Angle table */}
      <View style={frameStyles.table}>
        <View style={frameStyles.tableHeader}>
          <Text style={[frameStyles.tableCell, frameStyles.tableHeaderText, { flex: 2 }]}>Joint</Text>
          <Text style={[frameStyles.tableCell, frameStyles.tableHeaderText]}>You</Text>
          <Text style={[frameStyles.tableCell, frameStyles.tableHeaderText]}>Ref</Text>
          <Text style={[frameStyles.tableCell, frameStyles.tableHeaderText]}>Δ</Text>
        </View>
        {angleRows.map(row => {
          const delta = Math.abs(row.you - row.ref);
          const warn = delta > 15;
          return (
            <View key={row.joint} style={frameStyles.tableRow}>
              <Text style={[frameStyles.tableCell, { flex: 2, color: colors.textSecondary }]}>{row.joint}</Text>
              <Text style={[frameStyles.tableCell, { color: '#4d9fff' }]}>{row.you.toFixed(1)}°</Text>
              <Text style={[frameStyles.tableCell, { color: '#ff6b6b' }]}>{row.ref.toFixed(1)}°</Text>
              <Text style={[frameStyles.tableCell, { color: warn ? '#ffaa00' : colors.textSecondary }]}>
                {warn ? '⚠️ ' : ''}{delta.toFixed(1)}°
              </Text>
            </View>
          );
        })}
      </View>
      {/* GPT spine coaching */}
      {!!frame.spine_coaching && (() => {
        const text = frame.spine_coaching;
        const extract = (label: string) => {
          const match = text.match(new RegExp(`${label}:\\s*(.+?)(?=\\n[A-Z]+:|$)`, 's'));
          return match ? match[1].trim() : null;
        };
        const summary   = extract('SUMMARY');
        const yourForm  = extract('YOUR FORM');
        const reference = extract('REFERENCE');
        const tip       = extract('TIP');
        const isStructured = summary || yourForm || tip;
        return (
          <View style={frameStyles.coachingBox}>
            <Text style={frameStyles.coachingLabel}>🧠 Posture Coaching</Text>
            {isStructured ? (
              <>
                {summary && <Text style={frameStyles.coachingText}>{summary}</Text>}
                {yourForm && (
                  <View style={{ marginTop: 8 }}>
                    <Text style={{ color: '#4d9fff', fontWeight: '700', fontSize: 12, marginBottom: 2 }}>YOUR FORM</Text>
                    <Text style={frameStyles.coachingText}>{yourForm}</Text>
                  </View>
                )}
                {reference && (
                  <View style={{ marginTop: 8 }}>
                    <Text style={{ color: '#ff6b6b', fontWeight: '700', fontSize: 12, marginBottom: 2 }}>REFERENCE</Text>
                    <Text style={frameStyles.coachingText}>{reference}</Text>
                  </View>
                )}
                {tip && (
                  <View style={{ marginTop: 10, backgroundColor: '#1a2a1a', borderRadius: 6, padding: 10 }}>
                    <Text style={{ color: '#44cc88', fontWeight: '700', fontSize: 12, marginBottom: 2 }}>💡 TIP</Text>
                    <Text style={[frameStyles.coachingText, { color: '#aaffcc' }]}>{tip}</Text>
                  </View>
                )}
              </>
            ) : (
              <Text style={frameStyles.coachingText}>{text}</Text>
            )}
          </View>
        );
      })()}
    </View>
  );
}

export default function ResultScreen({ route, navigation }: Props) {
  const { result, exercise } = route.params;
  const [isLoadingVideo, setIsLoadingVideo] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoAuthHeaders, setVideoAuthHeaders] = useState<Record<string, string>>({});
  const [isLoadingRefVideo, setIsLoadingRefVideo] = useState(false);
  const [refVideoUrl, setRefVideoUrl] = useState<string | null>(null);
  const [refVideoAuthHeaders, setRefVideoAuthHeaders] = useState<Record<string, string>>({});

  // Calculate a simple score based on result (placeholder logic)
  const score = Math.floor(Math.random() * 20) + 80; // 80-100 for demo

  // Support both old and new API response formats
  const poseDownloadUrl = result.pose_download_url || result.download_url;
  const videoDownloadUrl = result.video_download_url;
  const videoAvailable = videoDownloadUrl != null;
  const refVideoDownloadUrl = result.reference_video_download_url;
  const refVideoAvailable = refVideoDownloadUrl != null;
  const refPoseDownloadUrl = result.reference_download_url;

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

  // Build the absolute URL for a relative backend path
  const toAbsUrl = (url: string) =>
    url.startsWith('http') ? url : `${api.defaults.baseURL}${url}`;

  // Load preview of rendered video
  const loadVideoPreview = async () => {
    if (!videoDownloadUrl) return;

    if (Platform.OS !== 'web') {
      // On native, expo-av can stream directly via HTTP with an Authorization header.
      // URL.createObjectURL does not exist in React Native.
      const token = getAccessToken();
      setVideoUrl(toAbsUrl(videoDownloadUrl));
      if (token) setVideoAuthHeaders({ Authorization: `Bearer ${token}` });
      return;
    }

    // Web: fetch as authenticated blob then create an object URL
    try {
      setIsLoadingVideo(true);
      const response = await api.get(videoDownloadUrl, { responseType: 'blob' });
      const blob = new Blob([response.data], { type: 'video/mp4' });
      setVideoUrl(URL.createObjectURL(blob));
    } catch (e: any) {
      console.error('Failed to load video preview:', e.message);
    } finally {
      setIsLoadingVideo(false);
    }
  };

  const loadRefVideoPreview = async () => {
    if (!refVideoDownloadUrl) return;

    if (Platform.OS !== 'web') {
      const token = getAccessToken();
      setRefVideoUrl(toAbsUrl(refVideoDownloadUrl));
      if (token) setRefVideoAuthHeaders({ Authorization: `Bearer ${token}` });
      return;
    }

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
    if (refVideoAvailable) {
      loadRefVideoPreview();
    }
  }, [refVideoAvailable]);

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
                  source={{ uri: videoUrl, headers: videoAuthHeaders }}
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
                  source={{ uri: refVideoUrl, headers: refVideoAuthHeaders }}
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

        {/* ── Frame-by-frame comparison ── */}
        {result.comparison && result.comparison.frames && result.comparison.frames.length > 0 && (() => {
          // Compute median delta across all joints and all frames
          const allDeltas: number[] = [];
          result.comparison.frames.forEach((f: ComparisonFrame) => {
            allDeltas.push(
              Math.abs(f.right_knee_you - f.right_knee_ref),
              Math.abs(f.left_knee_you  - f.left_knee_ref),
              Math.abs(f.right_hip_you  - f.right_hip_ref),
              Math.abs(f.left_hip_you   - f.left_hip_ref),
            );
          });
          const sorted = [...allDeltas].sort((a, b) => a - b);
          const medianDelta = sorted[Math.floor(sorted.length / 2)];
          const videosNotSimilar = medianDelta > 20;

          return (
            <View style={styles.comparisonSection}>
              <Text style={styles.comparisonTitle}>🔬 Frame-by-Frame Comparison</Text>
              <Text style={styles.comparisonSub}>
                DTW cost: {result.comparison.dtw_cost.toFixed(2)}  ·  {result.comparison.n_matched_frames} matched frames
              </Text>

              {/* Similarity warning banner */}
              {videosNotSimilar && (
                <View style={{
                  backgroundColor: '#2d1010',
                  borderLeftWidth: 4,
                  borderLeftColor: '#ff4444',
                  borderRadius: 8,
                  padding: 14,
                  marginBottom: 12,
                }}>
                  <Text style={{ color: '#ff4444', fontWeight: '700', fontSize: 15, marginBottom: 4 }}>
                    ⚠️ Videos Are Not Similar
                  </Text>
                  <Text style={{ color: '#ffaaaa', fontSize: 13, lineHeight: 19 }}>
                    The median joint angle difference is {medianDelta.toFixed(1)}° (threshold: 20°). 
                    Your movement pattern differs significantly from the reference. 
                    Try to match the pace, range of motion, and posture of the reference video.
                  </Text>
                </View>
              )}

              {result.comparison.frames.map((f: ComparisonFrame, i: number) => (
                <FrameCard key={i} frame={f} index={i} />
              ))}
            </View>
          );
        })()}

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
            onPress={() => navigation.navigate("Main")}
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
  comparisonSection: {
    marginBottom: 24,
  },
  comparisonTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  comparisonSub: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 16,
  },
});

// ─── Styles for FrameCard ─────────────────────────────────────────────────────
const frameStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.backgroundCard,
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 12,
  },
  imageRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  imageBox: {
    flex: 1,
    alignItems: 'center',
  },
  imageLabel: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
    letterSpacing: 1,
  },
  image: {
    width: '100%',
    aspectRatio: 0.75,
    borderRadius: 8,
    backgroundColor: '#111',
  },
  table: {
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 12,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: colors.backgroundLight,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  tableHeaderText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  tableCell: {
    flex: 1,
    fontSize: 12,
    color: colors.textPrimary,
  },
  coachingBox: {
    backgroundColor: colors.backgroundLight,
    borderRadius: 8,
    padding: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#a855f7',
  },
  coachingLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#a855f7',
    marginBottom: 6,
  },
  coachingText: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 20,
  },
});
