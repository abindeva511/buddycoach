import React, { useState } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, Platform } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../navigation/types";
import api from "../api/api";

type Props = NativeStackScreenProps<RootStackParamList, "Upload">;

export default function UploadScreen({ route, navigation }: Props) {
  const { workout } = route.params;
  const [file, setFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [loading, setLoading] = useState(false);

  const pickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: "video/*" });
    if (!result.canceled) setFile(result.assets[0]);
  };

  const analyze = async () => {
    if (!file) return;

    setLoading(true);
    navigation.navigate("Processing");

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

    const analysis = await api.post("/api/v1/analysis", {
      file_id: upload.data.id,
      analysis_type: workout,
    });

    navigation.replace("Result", { result: analysis.data });
  };

  return (
    <View style={{ flex: 1, padding: 20 }}>
      <Text style={{ fontSize: 22 }}>{workout}</Text>

      <TouchableOpacity onPress={pickFile} style={btn}>
        <Text>Select Video</Text>
      </TouchableOpacity>

      {file && <Text>{file.name}</Text>}

      {file && (
        <TouchableOpacity onPress={analyze} style={btn}>
          {loading ? <ActivityIndicator /> : <Text>Analyze</Text>}
        </TouchableOpacity>
      )}
    </View>
  );
}

const btn = {
  backgroundColor: "#fff",
  padding: 15,
  borderRadius: 12,
  marginTop: 15,
};
