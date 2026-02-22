import React from "react";
import {
  View,
  Text,
  ActivityIndicator,
  StyleSheet,
} from "react-native";

export default function ProcessingScreen() {
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" />
      <Text style={styles.text}>
        Analyzing your workout...
      </Text>
      <Text style={styles.subText}>
        This may take about a minute.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
  },
  text: {
    marginTop: 20,
    fontSize: 18,
  },
  subText: {
    marginTop: 8,
    color: "#64748B",
  },
});