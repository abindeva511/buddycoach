import React, { useContext, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
  Modal,
  Alert,
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../navigation/types";
import { AuthContext } from "../context/AuthContext";
import { colors, shadows } from "../theme/colors";

type Props = NativeStackScreenProps<RootStackParamList, "Home">;

// Gym Workouts (available now)
const gymWorkouts = [
  {
    id: "squat",
    title: "Squats",
    emoji: "🏋️",
    description: "Perfect your form",
    color: colors.fitness,
    bgColor: "rgba(255, 107, 53, 0.2)",
  },
  {
    id: "pushup",
    title: "Push-ups",
    emoji: "💪",
    description: "Build upper body",
    color: colors.accent,
    bgColor: "rgba(0, 217, 255, 0.2)",
  },
  {
    id: "deadlift",
    title: "Deadlifts",
    emoji: "🦵",
    description: "Strengthen core",
    color: colors.warning,
    bgColor: "rgba(255, 179, 0, 0.2)",
  },
];

// Coming soon categories
const comingSoonCategories = [
  {
    id: "dance",
    title: "Dance Moves",
    emoji: "💃",
    description: "Learn choreography",
    color: colors.dance,
    bgColor: "rgba(224, 64, 251, 0.15)",
  },
  {
    id: "yoga",
    title: "Yoga Poses",
    emoji: "🧘",
    description: "Find your balance",
    color: colors.yoga,
    bgColor: "rgba(105, 240, 174, 0.15)",
  },
  {
    id: "sports",
    title: "Sports Form",
    emoji: "⚽",
    description: "Improve technique",
    color: colors.sports,
    bgColor: "rgba(0, 217, 255, 0.15)",
  },
  {
    id: "martial",
    title: "Martial Arts",
    emoji: "🥋",
    description: "Master movements",
    color: colors.warning,
    bgColor: "rgba(255, 179, 0, 0.15)",
  },
];

export default function HomeScreen({ navigation }: Props) {
  const { logout, user } = useContext(AuthContext);
  const [showComingSoon, setShowComingSoon] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("");

  const handleComingSoonPress = (title: string) => {
    setSelectedCategory(title);
    setShowComingSoon(true);
  };

  return (
    <View style={styles.container}>
      {/* Coming Soon Modal */}
      <Modal
        visible={showComingSoon}
        transparent
        animationType="fade"
        onRequestClose={() => setShowComingSoon(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalEmoji}>🚧</Text>
            <Text style={styles.modalTitle}>Under Development</Text>
            <Text style={styles.modalText}>
              {selectedCategory} analysis is coming soon! Our team is working hard to bring you this feature.
            </Text>
            <TouchableOpacity
              style={styles.modalButton}
              onPress={() => setShowComingSoon(false)}
            >
              <Text style={styles.modalButtonText}>Got it!</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Image 
            source={require("../../assets/logo.jpg")} 
            style={styles.headerLogo}
            resizeMode="contain"
          />
          <View>
            <Text style={styles.greeting}>Hello, Athlete! 👋</Text>
            <Text style={styles.headerSubtitle}>Ready to train?</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.logoutButton} onPress={logout}>
          <Text style={styles.logoutIcon}>🚪</Text>
        </TouchableOpacity>
      </View>

      <ScrollView 
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
      >
        {/* Stats Card */}
        <View style={styles.statsCard}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>0</Text>
            <Text style={styles.statLabel}>Sessions</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>0h</Text>
            <Text style={styles.statLabel}>Training</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>🔥</Text>
            <Text style={styles.statLabel}>Streak</Text>
          </View>
        </View>

        {/* Section Title */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Choose Activity</Text>
          <Text style={styles.sectionSubtitle}>Upload a video to analyze</Text>
        </View>

        {/* Gym Workouts Section */}
        <View style={styles.categorySection}>
          <View style={styles.categoryHeader}>
            <Text style={styles.categoryEmoji}>🏋️</Text>
            <View>
              <Text style={styles.categoryTitle}>Gym Workouts</Text>
              <Text style={styles.categorySubtitle}>Available now</Text>
            </View>
          </View>
          <View style={styles.subWorkoutGrid}>
            {gymWorkouts.map((workout) => (
              <TouchableOpacity
                key={workout.id}
                style={[styles.subWorkoutCard, { backgroundColor: workout.bgColor }]}
                onPress={() => navigation.navigate("Upload", { workout: workout.id })}
              >
                <Text style={styles.subWorkoutEmoji}>{workout.emoji}</Text>
                <Text style={[styles.subWorkoutTitle, { color: workout.color }]}>
                  {workout.title}
                </Text>
                <Text style={styles.subWorkoutDescription}>{workout.description}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Coming Soon Section */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>More Activities</Text>
          <Text style={styles.sectionSubtitle}>Coming soon</Text>
        </View>

        {/* Coming Soon Grid */}
        <View style={styles.workoutGrid}>
          {comingSoonCategories.map((workout) => (
            <TouchableOpacity
              key={workout.id}
              style={[styles.workoutCard, styles.comingSoonCard, { backgroundColor: workout.bgColor }]}
              onPress={() => handleComingSoonPress(workout.title)}
            >
              <View style={styles.comingSoonBadge}>
                <Text style={styles.comingSoonBadgeText}>Soon</Text>
              </View>
              <Text style={styles.workoutEmoji}>{workout.emoji}</Text>
              <Text style={[styles.workoutTitle, { color: workout.color }]}>
                {workout.title}
              </Text>
              <Text style={styles.workoutDescription}>{workout.description}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Pro Tip Card */}
        <View style={styles.tipCard}>
          <Text style={styles.tipIcon}>💡</Text>
          <View style={styles.tipContent}>
            <Text style={styles.tipTitle}>Pro Tip</Text>
            <Text style={styles.tipText}>
              Record your workout from a side angle for the best analysis results.
            </Text>
          </View>
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
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 20,
    backgroundColor: colors.backgroundLight,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
  },
  headerLogo: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginRight: 12,
  },
  greeting: {
    fontSize: 20,
    fontWeight: "bold",
    color: colors.textPrimary,
  },
  headerSubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 2,
  },
  logoutButton: {
    width: 44,
    height: 44,
    backgroundColor: colors.backgroundCard,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
  },
  logoutIcon: {
    fontSize: 20,
  },
  scrollView: {
    flex: 1,
    padding: 20,
  },
  statsCard: {
    flexDirection: "row",
    backgroundColor: colors.backgroundCard,
    borderRadius: 20,
    padding: 20,
    marginBottom: 24,
    ...shadows.card,
  },
  statItem: {
    flex: 1,
    alignItems: "center",
  },
  statValue: {
    fontSize: 24,
    fontWeight: "bold",
    color: colors.primary,
  },
  statLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 4,
  },
  statDivider: {
    width: 1,
    backgroundColor: colors.border,
    marginVertical: 4,
  },
  sectionHeader: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: "bold",
    color: colors.textPrimary,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 4,
  },
  workoutGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  workoutCard: {
    width: "48%",
    padding: 20,
    borderRadius: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  workoutEmoji: {
    fontSize: 36,
    marginBottom: 12,
  },
  workoutTitle: {
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 4,
  },
  workoutDescription: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.8)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalContent: {
    backgroundColor: colors.backgroundCard,
    borderRadius: 24,
    padding: 32,
    alignItems: "center",
    width: "100%",
    maxWidth: 340,
  },
  modalEmoji: {
    fontSize: 64,
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: colors.textPrimary,
    marginBottom: 12,
  },
  modalText: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 24,
  },
  modalButton: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 48,
    borderRadius: 16,
  },
  modalButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  // Category section styles
  categorySection: {
    backgroundColor: colors.backgroundCard,
    borderRadius: 20,
    padding: 16,
    marginBottom: 24,
    ...shadows.card,
  },
  categoryHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  categoryEmoji: {
    fontSize: 32,
    marginRight: 12,
  },
  categoryTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: colors.primary,
  },
  categorySubtitle: {
    fontSize: 12,
    color: colors.success,
    marginTop: 2,
  },
  subWorkoutGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  subWorkoutCard: {
    width: "31%",
    padding: 12,
    borderRadius: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  subWorkoutEmoji: {
    fontSize: 28,
    marginBottom: 8,
  },
  subWorkoutTitle: {
    fontSize: 12,
    fontWeight: "bold",
    marginBottom: 2,
    textAlign: "center",
  },
  subWorkoutDescription: {
    fontSize: 10,
    color: colors.textSecondary,
    textAlign: "center",
  },
  // Coming soon styles
  comingSoonCard: {
    opacity: 0.7,
    position: "relative",
  },
  comingSoonBadge: {
    position: "absolute",
    top: 10,
    right: 10,
    backgroundColor: colors.secondary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  comingSoonBadgeText: {
    fontSize: 10,
    fontWeight: "bold",
    color: "#fff",
  },
  tipCard: {
    flexDirection: "row",
    backgroundColor: colors.backgroundCard,
    borderRadius: 16,
    padding: 16,
    marginBottom: 40,
    borderLeftWidth: 4,
    borderLeftColor: colors.warning,
  },
  tipIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  tipContent: {
    flex: 1,
  },
  tipTitle: {
    fontSize: 14,
    fontWeight: "bold",
    color: colors.warning,
    marginBottom: 4,
  },
  tipText: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
});
