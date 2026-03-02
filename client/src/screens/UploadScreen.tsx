import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Image,
  ScrollView,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../navigation/types";
import api from "../api/api";
import { colors, shadows } from "../theme/colors";

type Props = NativeStackScreenProps<RootStackParamList, "Upload">;

const workoutInfo: Record<string, { emoji: string; title: string; tips: string[] }> = {
  squat: {
    emoji: "🏋️",
    title: "Squats",
    tips: ["Keep your back straight", "Knees over toes", "Go parallel or below"],
  },
  pushup: {
    emoji: "💪",
    title: "Push-ups",
    tips: ["Core tight", "Elbows at 45°", "Full range of motion"],
  },
  dance: {
    emoji: "💃",
    title: "Dance Moves",
    tips: ["Clear full body view", "Good lighting", "Stable camera"],
  },
  yoga: {
    emoji: "🧘",
    title: "Yoga Poses",
    tips: ["Show full pose", "Side angle works best", "Hold positions steady"],
  },
  sports: {
    emoji: "⚽",
    title: "Sports Form",
    tips: ["Capture full movement", "Multiple angles help", "Slow motion if possible"],
  },
  martial: {
    emoji: "🥋",
    title: "Martial Arts",
    tips: ["Full body in frame", "Clear background", "Proper stance visible"],
  },
};

export default function UploadScreen({ route, navigation }: Props) {
  const { workout } = route.params;
  const [file, setFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const info = workoutInfo[workout] || workoutInfo.squat;

  const pickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: "video/*" });
      if (!result.canceled) {
        setFile(result.assets[0]);
        setError("");
      }
    } catch (e) {
      setError("Failed to pick video");
    }
  };

  const analyze = async () => {
    if (!file) return;

    setLoading(true);
    navigation.navigate("Processing");

    try {
      const formData = new FormData();
      if (Platform.OS === "web") {
        if (file.file) {
          formData.append("file", file.file, file.name);
        } else {
          const blob = await fetch(file.uri).then((r) => r.blob());
          formData.append("file", blob, file.name);
        }
      } else {
        formData.append("file", {
          uri: file.uri,
          name: file.name,
          type: file.mimeType ?? "application/octet-stream",
        } as any);
      }

      const upload = await api.post("/api/v1/files", formData);

      const analysis = await api.post("/api/v1/analysis/pose3d", {
        file_id: upload.data.id,
      });

      navigation.replace("Result", { result: analysis.data });
    } catch (e: any) {
      navigation.goBack();
      setError(e.response?.data?.detail || "Analysis failed");
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backButton} 
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{info.title}</Text>
        <View style={{ width: 44 }} />
      </View>

      {/* Content */}
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.iconContainer}>
          <Text style={styles.emoji}>{info.emoji}</Text>
        </View>

        <Text style={styles.title}>Upload Your Video</Text>
        <Text style={styles.subtitle}>
          Our AI will analyze your form and provide feedback
        </Text>

        {/* Tips */}
        <View style={styles.tipsContainer}>
          <Text style={styles.tipsTitle}>Tips for best results:</Text>
          {info.tips.map((tip, index) => (
            <View key={index} style={styles.tipRow}>
              <Text style={styles.tipBullet}>✓</Text>
              <Text style={styles.tipText}>{tip}</Text>
            </View>
          ))}
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {/* Upload Area */}
        <TouchableOpacity style={styles.uploadArea} onPress={pickFile}>
          {file ? (
            <View style={styles.fileSelected}>
              <Text style={styles.fileIcon}>🎬</Text>
              <Text style={styles.fileName} numberOfLines={1}>
                {file.name}
              </Text>
              <Text style={styles.changeText}>Tap to change</Text>
            </View>
          ) : (
            <View style={styles.uploadPlaceholder}>
              <Text style={styles.uploadIcon}>📹</Text>
              <Text style={styles.uploadText}>Tap to select video</Text>
              <Text style={styles.uploadSubtext}>MP4, MOV, or AVI</Text>
            </View>
          )}
        </TouchableOpacity>

        {/* Analyze Button */}
        {file && (
          <TouchableOpacity
            style={[styles.analyzeButton, loading && styles.buttonDisabled]}
            onPress={analyze}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Text style={styles.analyzeIcon}>🚀</Text>
                <Text style={styles.analyzeText}>Analyze My Form</Text>
              </>
            )}
          </TouchableOpacity>
        )}
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
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 20,
    backgroundColor: colors.backgroundLight,
  },
  backButton: {
    width: 44,
    height: 44,
    backgroundColor: colors.backgroundCard,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
  },
  backIcon: {
    fontSize: 24,
    color: colors.textPrimary,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: colors.textPrimary,
  },
  content: {
    flexGrow: 1,
    padding: 24,
    alignItems: "center",
    paddingBottom: 40,
  },
  iconContainer: {
    width: 80,
    height: 80,
    backgroundColor: colors.backgroundCard,
    borderRadius: 40,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
    ...shadows.card,
  },
  emoji: {
    fontSize: 40,
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
    marginBottom: 24,
  },
  tipsContainer: {
    width: "100%",
    backgroundColor: colors.backgroundCard,
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
  },
  tipsTitle: {
    fontSize: 14,
    fontWeight: "bold",
    color: colors.textSecondary,
    marginBottom: 12,
  },
  tipRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  tipBullet: {
    color: colors.success,
    fontSize: 14,
    marginRight: 8,
  },
  tipText: {
    fontSize: 14,
    color: colors.textPrimary,
  },
  errorText: {
    color: "#FF5252",
    marginBottom: 16,
    fontSize: 14,
  },
  uploadArea: {
    width: "100%",
    backgroundColor: colors.backgroundCard,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: colors.border,
    borderStyle: "dashed",
    padding: 32,
    alignItems: "center",
    marginBottom: 24,
  },
  uploadPlaceholder: {
    alignItems: "center",
  },
  uploadIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  uploadText: {
    fontSize: 16,
    fontWeight: "bold",
    color: colors.textPrimary,
    marginBottom: 4,
  },
  uploadSubtext: {
    fontSize: 12,
    color: colors.textMuted,
  },
  fileSelected: {
    alignItems: "center",
  },
  fileIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  fileName: {
    fontSize: 14,
    fontWeight: "bold",
    color: colors.success,
    marginBottom: 4,
  },
  changeText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  analyzeButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    width: "100%",
    paddingVertical: 18,
    borderRadius: 16,
    ...shadows.button,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  analyzeIcon: {
    fontSize: 20,
    marginRight: 8,
  },
  analyzeText: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#fff",
  },
});
