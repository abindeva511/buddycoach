import React, { useState, useEffect, useCallback } from 'react';
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
import { useNavigation, DrawerActions, NavigationProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/types';
import { exerciseApi, MuscleGroupAPI, ExerciseSearchResult } from '../api/api';

export default function ForgeFitHomeScreen() {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMuscle, setSelectedMuscle] = useState<number | null>(null);
  const [muscleGroups, setMuscleGroups] = useState<MuscleGroupAPI[]>([]);
  const [searchResults, setSearchResults] = useState<ExerciseSearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);

  // Fetch muscle groups on mount
  useEffect(() => {
    fetchMuscleGroups();
  }, []);

  // Debounced search
  useEffect(() => {
    if (searchQuery.length < 2) {
      setSearchResults([]);
      setShowSearchResults(false);
      return;
    }

    const timeoutId = setTimeout(() => {
      searchExercises(searchQuery);
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  const fetchMuscleGroups = async () => {
    try {
      setLoading(true);
      const data = await exerciseApi.getMuscleGroups();
      setMuscleGroups(data);
    } catch (error) {
      console.error('Failed to fetch muscle groups:', error);
    } finally {
      setLoading(false);
    }
  };

  const searchExercises = async (query: string) => {
    try {
      setSearching(true);
      const results = await exerciseApi.searchExercises(query, 8);
      setSearchResults(results);
      setShowSearchResults(true);
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setSearching(false);
    }
  };

  const handleMusclePress = (muscle: MuscleGroupAPI) => {
    setSelectedMuscle(muscle.id);
    setShowSearchResults(false);
    (navigation as any).navigate('ExerciseList', { 
      muscleGroup: {
        id: String(muscle.id),
        name: muscle.name,
        icon: muscle.icon,
        exerciseCount: muscle.exerciseCount,
      }
    });
  };

  const handleSearchResultPress = (result: ExerciseSearchResult) => {
    setSearchQuery('');
    setShowSearchResults(false);
    // Navigate to exercise detail (or muscle group for now)
    const muscleGroup = muscleGroups.find(m => m.name === result.muscle_group_name);
    if (muscleGroup) {
      handleMusclePress(muscleGroup);
    }
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning,';
    if (hour < 17) return 'Good afternoon,';
    return 'Good evening,';
  };

  const totalExercises = muscleGroups.reduce((sum, m) => sum + m.exerciseCount, 0);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.bg} />
      <ScrollView 
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity 
            style={styles.menuButton}
            onPress={() => navigation.dispatch(DrawerActions.openDrawer())}
          >
            <Text style={styles.menuIcon}>☰</Text>
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.greeting}>{getGreeting()}</Text>
            <Text style={styles.userName}>{mockUser.firstName} {mockUser.lastName}</Text>
          </View>
          <TouchableOpacity 
            style={styles.avatar}
            onPress={() => navigation.dispatch(DrawerActions.openDrawer())}
          >
            <Text style={styles.avatarText}>{mockUser.initials}</Text>
          </TouchableOpacity>
        </View>

        {/* Hero Card */}
        <View style={styles.heroCard}>
          <View style={styles.heroContent}>
            <View style={styles.heroTag}>
              <Text style={styles.heroTagText}>SELF TRAINER MODE</Text>
            </View>
            <Text style={styles.heroTitle}>Gym{'\n'}Workouts</Text>
            <Text style={styles.heroSub}>{totalExercises}+ exercises available</Text>
          </View>
          <Text style={styles.heroIcon}>🏋️</Text>
        </View>

        {/* Search */}
        <View style={styles.searchWrapper}>
          <View style={styles.searchContainer}>
            <Text style={styles.searchIcon}>🔍</Text>
            <TextInput
              style={styles.searchInput}
              placeholder="Search exercises..."
              placeholderTextColor={colors.muted}
              value={searchQuery}
              onChangeText={setSearchQuery}
              onFocus={() => searchQuery.length >= 2 && setShowSearchResults(true)}
            />
            {searching && (
              <ActivityIndicator size="small" color={colors.accent} style={{ marginRight: 8 }} />
            )}
            {searchQuery.length > 0 && (
              <TouchableOpacity 
                style={styles.clearButton}
                onPress={() => {
                  setSearchQuery('');
                  setShowSearchResults(false);
                }}
              >
                <Text style={styles.clearIcon}>✕</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Search Results Dropdown */}
          {showSearchResults && searchResults.length > 0 && (
            <View style={styles.searchDropdown}>
              {searchResults.map((result, index) => (
                <TouchableOpacity
                  key={`${result.id}-${index}`}
                  style={styles.searchResultItem}
                  onPress={() => handleSearchResultPress(result)}
                >
                  <View style={styles.searchResultIcon}>
                    <Text>🏋️</Text>
                  </View>
                  <View style={styles.searchResultInfo}>
                    <Text style={styles.searchResultName}>{result.exercise_name}</Text>
                    <Text style={styles.searchResultMeta}>
                      {result.muscle_name} • {result.equipment_type}
                    </Text>
                  </View>
                  <Text style={styles.searchResultArrow}>›</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* Muscle Groups Section */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>MUSCLE GROUPS</Text>
          <TouchableOpacity>
            <Text style={styles.seeAll}>{muscleGroups.length} groups</Text>
          </TouchableOpacity>
        </View>

        {/* Loading State */}
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.accent} />
            <Text style={styles.loadingText}>Loading exercises...</Text>
          </View>
        ) : (
          /* Muscle Grid */
          <View style={styles.muscleGrid}>
            {muscleGroups.map((muscle) => (
              <TouchableOpacity
                key={muscle.id}
                style={[
                  styles.muscleCard,
                  selectedMuscle === muscle.id && styles.muscleCardActive,
                ]}
                onPress={() => handleMusclePress(muscle)}
                activeOpacity={0.7}
              >
                <View style={[
                  styles.muscleIconBox,
                  selectedMuscle === muscle.id && styles.muscleIconBoxActive,
                ]}>
                  <Text style={styles.muscleIcon}>{muscle.icon}</Text>
                </View>
                <View style={styles.muscleInfo}>
                  <Text style={styles.muscleName}>{muscle.name}</Text>
                  <Text style={styles.muscleCount}>{muscle.exerciseCount} exercises</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Bottom Navigation */}
      <View style={styles.bottomNav}>
        <TouchableOpacity style={styles.navItem}>
          <Text style={[styles.navIcon, styles.navIconActive]}>🏠</Text>
          <Text style={[styles.navLabel, styles.navLabelActive]}>Home</Text>
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
    marginBottom: spacing.lg,
  },
  menuButton: {
    width: 40,
    height: 40,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  menuIcon: {
    fontSize: 20,
    color: colors.text,
  },
  headerCenter: {
    flex: 1,
    marginLeft: spacing.md,
  },
  greeting: {
    fontSize: 12,
    color: colors.muted,
    fontWeight: '500',
  },
  userName: {
    fontSize: 24,
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

  // Hero Card
  heroCard: {
    backgroundColor: colors.accent2,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    marginBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  heroContent: {
    flex: 1,
  },
  heroTag: {
    backgroundColor: colors.accent,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: borderRadius.pill,
    alignSelf: 'flex-start',
    marginBottom: 10,
  },
  heroTagText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 1,
    textTransform: 'uppercase',
    lineHeight: 32,
  },
  heroSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
    marginTop: 4,
  },
  heroIcon: {
    fontSize: 50,
    marginLeft: spacing.md,
  },

  // Search
  searchWrapper: {
    position: 'relative',
    zIndex: 100,
    marginBottom: spacing.md,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
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
  clearButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.surface2,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 4,
  },
  clearIcon: {
    fontSize: 12,
    color: colors.muted,
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

  // Search Dropdown
  searchDropdown: {
    position: 'absolute',
    top: 50,
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    maxHeight: 300,
  },
  searchResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  searchResultIcon: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.surface2,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  searchResultInfo: {
    flex: 1,
  },
  searchResultName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  searchResultMeta: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
  searchResultArrow: {
    fontSize: 18,
    color: colors.muted,
  },

  // Loading
  loadingContainer: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: colors.muted,
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
    textTransform: 'uppercase',
  },
  seeAll: {
    fontSize: 12,
    color: colors.accent,
    fontWeight: '600',
  },

  // Muscle Grid
  muscleGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -4,
  },
  muscleCard: {
    width: '48%',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginHorizontal: '1%',
    marginBottom: spacing.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
  },
  muscleCardWide: {
    width: '98%',
  },
  muscleCardActive: {
    borderColor: colors.accent,
    backgroundColor: colors.tagBg,
  },
  muscleIconBox: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.surface2,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  muscleIconBoxActive: {
    backgroundColor: colors.accent,
  },
  muscleIcon: {
    fontSize: 20,
  },
  muscleInfo: {
    flex: 1,
  },
  muscleName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  muscleCount: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
  hotBadge: {
    backgroundColor: colors.tagBg,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: borderRadius.pill,
  },
  hotBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.accent,
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
  navIcon: {
    fontSize: 20,
    marginBottom: 2,
  },
  navIconActive: {
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
    color: colors.accent,
  },
});
