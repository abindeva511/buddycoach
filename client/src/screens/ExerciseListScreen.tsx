import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import { colors, spacing, borderRadius } from '../theme/forgefit';
import { mockUser } from '../types/fitness';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { exerciseApi, ExerciseAPI } from '../api/api';

type Props = NativeStackScreenProps<RootStackParamList, 'ExerciseList'>;

function categorizeEquipment(eq: string | null | undefined): string {
  if (!eq) return 'Bodyweight';
  const e = eq.trim();
  if (e === 'Barbell' || e === 'B' || e.startsWith('BB')) return 'Barbell';
  if (e === 'Dumbbell' || e.startsWith('DB')) return 'Dumbbell';
  if (e === 'Cable' || e === 'C' || e.startsWith('CB')) return 'Cable';
  if (e === 'Body Weight' || e === 'Bodyweight' || e.startsWith('BW')) return 'Bodyweight';
  if (e === 'Lever' || e.startsWith('LV')) return 'Machine';
  if (e === 'Sled' || e.startsWith('SL')) return 'Sled';
  if (e === 'Smith' || e.startsWith('SM')) return 'Smith';
  return 'Other';
}

export default function ExerciseListScreen({ navigation, route }: Props) {
  const { muscleGroup } = route.params;
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('All');
  const [exercises, setExercises] = useState<ExerciseAPI[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchExercises();
  }, [muscleGroup.id]);

  const fetchExercises = async () => {
    try {
      setLoading(true);
      const data = await exerciseApi.getExercisesByMuscle(Number(muscleGroup.id), 0, 300);
      setExercises(data);
    } catch (error) {
      console.error('Failed to fetch exercises:', error);
    } finally {
      setLoading(false);
    }
  };

  const filterOptions = useMemo(() => {
    const cats = new Set(exercises.map(e => categorizeEquipment(e.equipment_type)));
    const order = ['Barbell', 'Dumbbell', 'Cable', 'Bodyweight', 'Machine', 'Sled', 'Smith', 'Other'];
    return ['All', ...order.filter(c => cats.has(c))];
  }, [exercises]);

  const filteredExercises = useMemo(() => {
    return exercises.filter((exercise) => {
      const matchesSearch = exercise.exercise_name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesFilter =
        activeFilter === 'All' ||
        categorizeEquipment(exercise.equipment_type) === activeFilter;
      return matchesSearch && matchesFilter;
    });
  }, [exercises, searchQuery, activeFilter]);

  const handleExercisePress = (exercise: ExerciseAPI) => {
    navigation.navigate('ExerciseDetail', { exercise });
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.bg} />
      <ScrollView 
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity 
            style={styles.backButton}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.backIcon}>←</Text>
          </TouchableOpacity>
          <Text style={styles.title}>{muscleGroup.name}</Text>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{mockUser.initials}</Text>
          </View>
        </View>

        {/* Breadcrumb */}
        <View style={styles.breadcrumb}>
          <TouchableOpacity onPress={() => navigation.navigate('ForgeFitHome')}>
            <Text style={styles.breadcrumbLink}>Home</Text>
          </TouchableOpacity>
          <Text style={styles.breadcrumbSep}> › </Text>
          <TouchableOpacity onPress={() => navigation.navigate('ForgeFitHome')}>
            <Text style={styles.breadcrumbLink}>Muscle Groups</Text>
          </TouchableOpacity>
          <Text style={styles.breadcrumbSep}> › </Text>
          <Text style={styles.breadcrumbActive}>{muscleGroup.name}</Text>
        </View>

        {/* Muscle Hero */}
        <View style={styles.muscleHero}>
          <View style={styles.muscleHeroIcon}>
            <Text style={styles.muscleHeroEmoji}>{muscleGroup.icon}</Text>
          </View>
          <View style={styles.muscleHeroText}>
            <Text style={styles.muscleHeroName}>{muscleGroup.name}</Text>
            <Text style={styles.muscleHeroSub}>
              {muscleGroup.exerciseCount} exercises · Beginner to Advanced
            </Text>
          </View>
        </View>

        {/* Search */}
        <View style={styles.searchContainer}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder={`Search ${muscleGroup.name.toLowerCase()} exercises...`}
            placeholderTextColor={colors.muted}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          <TouchableOpacity style={styles.filterButton}>
            <Text style={styles.filterIcon}>⚙</Text>
          </TouchableOpacity>
        </View>

        {/* Filter Pills */}
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false}
          style={styles.filterRow}
          contentContainerStyle={styles.filterRowContent}
        >
          {filterOptions.map((filter) => (
            <TouchableOpacity
              key={filter}
              style={[
                styles.filterPill,
                activeFilter === filter && styles.filterPillActive,
              ]}
              onPress={() => setActiveFilter(filter)}
            >
              <Text style={[
                styles.filterPillText,
                activeFilter === filter && styles.filterPillTextActive,
              ]}>
                {filter}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Exercise Count Header */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{filteredExercises.length} EXERCISES</Text>
          <TouchableOpacity>
            <Text style={styles.sortButton}>A–Z ↕</Text>
          </TouchableOpacity>
        </View>

        {/* Loading State */}
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.accent} />
            <Text style={styles.loadingText}>Loading exercises...</Text>
          </View>
        ) : (
          /* Exercise List */
          <View style={styles.exerciseList}>
            {filteredExercises.map((exercise, index) => (
              <TouchableOpacity
                key={`${exercise.id}-${index}`}
                style={styles.exerciseCard}
                onPress={() => handleExercisePress(exercise)}
                activeOpacity={0.7}
              >
                <View style={styles.exerciseNum}>
                  <Text style={styles.exerciseNumText}>{index + 1}</Text>
                </View>
                <View style={styles.exerciseInfo}>
                  <View style={styles.exerciseNameRow}>
                    <Text style={styles.exerciseName}>{exercise.exercise_name}</Text>
                    {exercise.has_video && (
                      <Text style={styles.videoTag}>▶</Text>
                    )}
                  </View>
                  <View style={styles.exerciseMeta}>
                    {exercise.equipment_type && (
                      <View style={styles.metaTag}>
                        <Text style={styles.metaTagText}>{exercise.equipment_type}</Text>
                      </View>
                    )}
                    {exercise.muscle_name && (
                      <View style={styles.metaTag}>
                        <Text style={styles.metaTagText}>{exercise.muscle_name}</Text>
                      </View>
                    )}
                  </View>
                </View>
                <Text style={styles.exerciseArrow}>›</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {!loading && filteredExercises.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🔍</Text>
            <Text style={styles.emptyText}>No exercises found</Text>
            <Text style={styles.emptySubtext}>Try adjusting your search or filters</Text>
          </View>
        )}
      </ScrollView>

      {/* Bottom Navigation */}
      <View style={styles.bottomNav}>
        <TouchableOpacity style={[styles.navItem, styles.navItemActive]}>
          <Text style={styles.navIconActive}>🏠</Text>
          <Text style={styles.navLabelActive}>Home</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navItem}>
          <Text style={styles.navIcon}>📋</Text>
          <Text style={styles.navLabel}>Plans</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navItem}>
          <Text style={styles.navIcon}>📊</Text>
          <Text style={styles.navLabel}>Stats</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navItem}>
          <Text style={styles.navIcon}>👤</Text>
          <Text style={styles.navLabel}>Profile</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: 100,
  },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  backButton: {
    width: 40,
    height: 40,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  backIcon: {
    fontSize: 18,
    color: colors.text,
    fontWeight: '600',
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  avatar: {
    width: 40,
    height: 40,
    backgroundColor: colors.accent,
    borderRadius: borderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },

  // Breadcrumb
  breadcrumb: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  breadcrumbText: {
    fontSize: 12,
    color: colors.muted,
    fontWeight: '500',
  },
  breadcrumbSep: {
    fontSize: 12,
    color: colors.muted,
  },
  breadcrumbActive: {
    fontSize: 12,
    color: colors.accent,
    fontWeight: '700',
  },
  breadcrumbLink: {
    fontSize: 12,
    color: colors.muted,
    fontWeight: '500',
    textDecorationLine: 'underline',
  },

  // Muscle Hero
  muscleHero: {
    backgroundColor: colors.accent2,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  muscleHeroIcon: {
    width: 56,
    height: 56,
    backgroundColor: colors.accent,
    borderRadius: borderRadius.lg,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  muscleHeroEmoji: {
    fontSize: 28,
  },
  muscleHeroText: {
    flex: 1,
  },
  muscleHeroName: {
    fontSize: 26,
    fontWeight: '800',
    color: '#fff',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  muscleHeroSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.45)',
    marginTop: 4,
  },

  // Search
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.md,
  },
  searchIcon: {
    fontSize: 16,
    marginRight: spacing.sm,
  },
  searchInput: {
    flex: 1,
    height: 44,
    fontSize: 13,
    color: colors.text,
  },
  filterButton: {
    backgroundColor: colors.accent,
    width: 30,
    height: 30,
    borderRadius: borderRadius.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterIcon: {
    fontSize: 14,
    color: '#fff',
  },

  // Filter Pills
  filterRow: {
    marginBottom: spacing.md,
  },
  filterRowContent: {
    paddingRight: spacing.lg,
    gap: 8,
  },
  filterPill: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: borderRadius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 8,
  },
  filterPillActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  filterPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.muted,
  },
  filterPillTextActive: {
    color: '#fff',
  },

  // Section Header
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: colors.text,
  },
  sortButton: {
    fontSize: 12,
    color: colors.accent,
    fontWeight: '600',
  },

  // Exercise List
  exerciseList: {
    gap: 10,
  },
  exerciseCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
  },
  exerciseNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  videoTag: {
    fontSize: 10,
    color: colors.accent,
  },
  exerciseNum: {
    width: 32,
    height: 32,
    backgroundColor: colors.surface2,
    borderRadius: borderRadius.sm,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  exerciseNumText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.muted,
  },
  exerciseInfo: {
    flex: 1,
  },
  exerciseName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  exerciseMeta: {
    flexDirection: 'row',
    gap: 8,
  },
  metaTag: {
    backgroundColor: colors.surface2,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  metaTagText: {
    fontSize: 10,
    color: colors.muted,
    fontWeight: '500',
  },
  exerciseArrow: {
    fontSize: 20,
    color: colors.muted,
  },

  // Loading State
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
  },
  loadingText: {
    fontSize: 14,
    color: colors.muted,
    marginTop: spacing.md,
  },

  // Empty State
  emptyState: {
    alignItems: 'center',
    paddingTop: spacing.xxl,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  emptySubtext: {
    fontSize: 14,
    color: colors.muted,
  },

  // Bottom Navigation
  bottomNav: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: 12,
    paddingBottom: 24,
    justifyContent: 'space-around',
  },
  navItem: {
    alignItems: 'center',
    opacity: 0.35,
  },
  navItemActive: {
    opacity: 1,
  },
  navIcon: {
    fontSize: 20,
    marginBottom: 2,
  },
  navIconActive: {
    fontSize: 20,
    marginBottom: 2,
    color: colors.accent,
  },
  navLabel: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    color: colors.text,
    letterSpacing: 0.5,
  },
  navLabelActive: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    color: colors.accent,
    letterSpacing: 0.5,
  },
});
