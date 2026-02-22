import React from "react";
import {
  ScrollView,
  Text,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "Result">;

export default function ResultScreen({ route, navigation }: Props) {
  const { result } = route.params;

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Analysis Result</Text>

      <Text style={styles.processing}>
        Processing Time: {result.processing_time_seconds}s
      </Text>

      <Text style={styles.resultText}>
        {result.result}
      </Text>

      <TouchableOpacity
        style={styles.button}
        onPress={() => navigation.navigate("Home")}
      >
        <Text style={styles.buttonText}>
          Analyze Another
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: "#F8FAFC",
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
  },
  processing: {
    marginVertical: 10,
    color: "#64748B",
  },
  resultText: {
    marginVertical: 15,
    fontSize: 16,
  },
  button: {
    backgroundColor: "#2563EB",
    padding: 15,
    borderRadius: 12,
    marginTop: 20,
  },
  buttonText: {
    color: "#fff",
    textAlign: "center",
    fontWeight: "bold",
  },
});