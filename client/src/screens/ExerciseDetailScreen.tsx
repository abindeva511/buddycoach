import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  Dimensions,
  ActivityIndicator,
  Linking,
  Platform,
  Alert,
} from 'react-native';
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import Slider from '@react-native-community/slider';
import { colors, spacing, borderRadius } from '../theme/forgefit';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { exerciseApi } from '../api/api';

type Props = NativeStackScreenProps<RootStackParamList, 'ExerciseDetail'>;

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const VIDEO_HEIGHT = (SCREEN_WIDTH * 9) / 16; // 16:9 aspect ratio

export default function ExerciseDetailScreen({ navigation, route }: Props) {
  const { exercise } = route.params;
  const videoRef = useRef<Video>(null);
  const userVideoRef = useRef<Video>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userVideo, setUserVideo] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  
  // Sync mode state
  const [syncMode, setSyncMode] = useState(false);
  const [syncPosition, setSyncPosition] = useState(0);
  const [syncDuration, setSyncDuration] = useState(0);
  const [refVideoDuration, setRefVideoDuration] = useState(0);
  const [userVideoDuration, setUserVideoDuration] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  
  // Individual video positions
  const [refVideoPosition, setRefVideoPosition] = useState(0);
  const [userVideoPosition, setUserVideoPosition] = useState(0);
  const [isSeekingRef, setIsSeekingRef] = useState(false);
  const [isSeekingUser, setIsSeekingUser] = useState(false);
  const [isRefVideoPlaying, setIsRefVideoPlaying] = useState(false);
  const [isUserVideoPlaying, setIsUserVideoPlaying] = useState(false);

  const videoUrl = exercise.has_video ? exerciseApi.getVideoUrl(exercise.id) : null;

  // Debug log
  console.log('Exercise:', exercise.exercise_name, 'has_video:', exercise.has_video, 'videoUrl:', videoUrl);

  const handlePlaybackStatusUpdate = (status: AVPlaybackStatus) => {
    if (status.isLoaded) {
      setIsLoading(false);
      setIsPlaying(status.isPlaying);
      setIsRefVideoPlaying(status.isPlaying);
      if (status.durationMillis) {
        setRefVideoDuration(status.durationMillis);
      }
      // Update sync position from reference video when in sync mode
      if (syncMode && !isSeeking && status.positionMillis !== undefined) {
        setSyncPosition(status.positionMillis);
      }
      // Track individual position
      if (!isSeekingRef && status.positionMillis !== undefined) {
        setRefVideoPosition(status.positionMillis);
      }
    }
  };

  const handleUserVideoStatusUpdate = (status: AVPlaybackStatus) => {
    if (status.isLoaded) {
      setIsUserVideoPlaying(status.isPlaying);
      if (status.durationMillis) {
        setUserVideoDuration(status.durationMillis);
      }
      // Track individual position
      if (!isSeekingUser && status.positionMillis !== undefined) {
        setUserVideoPosition(status.positionMillis);
      }
    }
  };

  // Individual video seek handlers
  const handleRefVideoSeek = async (value: number) => {
    setIsSeekingRef(false);
    if (videoRef.current) {
      await videoRef.current.setPositionAsync(value);
    }
  };

  const handleUserVideoSeek = async (value: number) => {
    setIsSeekingUser(false);
    if (userVideoRef.current) {
      await userVideoRef.current.setPositionAsync(value);
    }
  };

  // Individual video play/pause toggles
  const toggleRefVideo = async () => {
    if (videoRef.current) {
      if (isRefVideoPlaying) {
        await videoRef.current.pauseAsync();
      } else {
        await videoRef.current.playAsync();
      }
    }
  };

  const toggleUserVideo = async () => {
    if (userVideoRef.current) {
      if (isUserVideoPlaying) {
        await userVideoRef.current.pauseAsync();
      } else {
        await userVideoRef.current.playAsync();
      }
    }
  };

  // Calculate sync duration as the shorter of the two videos
  React.useEffect(() => {
    if (refVideoDuration > 0 && userVideoDuration > 0) {
      setSyncDuration(Math.min(refVideoDuration, userVideoDuration));
    } else if (refVideoDuration > 0) {
      setSyncDuration(refVideoDuration);
    } else if (userVideoDuration > 0) {
      setSyncDuration(userVideoDuration);
    }
  }, [refVideoDuration, userVideoDuration]);

  const togglePlayback = async () => {
    if (videoRef.current) {
      if (isPlaying) {
        await videoRef.current.pauseAsync();
      } else {
        await videoRef.current.playAsync();
      }
    }
  };

  const handleVideoError = (error: string) => {
    console.error('Video error:', error);
    setError(`Failed to load video: ${error}`);
    setIsLoading(false);
  };

  const pickVideoFromGallery = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please grant camera roll permissions to upload videos.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      allowsEditing: true,
      quality: 1,
      videoMaxDuration: 60,
    });

    if (!result.canceled && result.assets[0]) {
      setUserVideo(result.assets[0].uri);
    }
  };

  const recordVideo = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please grant camera permissions to record videos.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      allowsEditing: true,
      quality: 1,
      videoMaxDuration: 60,
    });

    if (!result.canceled && result.assets[0]) {
      setUserVideo(result.assets[0].uri);
    }
  };

  const handleUploadVideo = () => {
    Alert.alert(
      'Upload Your Workout',
      'Choose how you want to add your video',
      [
        { text: 'Record Video', onPress: recordVideo },
        { text: 'Choose from Gallery', onPress: pickVideoFromGallery },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const clearUserVideo = () => {
    setUserVideo(null);
  };

  const playBothVideos = async () => {
    const promises = [];
    if (videoRef.current) promises.push(videoRef.current.playAsync());
    if (userVideoRef.current) promises.push(userVideoRef.current.playAsync());
    await Promise.all(promises);
  };

  const pauseBothVideos = async () => {
    const promises = [];
    if (videoRef.current) promises.push(videoRef.current.pauseAsync());
    if (userVideoRef.current) promises.push(userVideoRef.current.pauseAsync());
    await Promise.all(promises);
  };

  const restartBothVideos = async () => {
    const promises = [];
    if (videoRef.current) promises.push(videoRef.current.replayAsync());
    if (userVideoRef.current) promises.push(userVideoRef.current.replayAsync());
    await Promise.all(promises);
    setSyncPosition(0);
  };

  const handleSyncSeek = async (value: number) => {
    setIsSeeking(true);
    setSyncPosition(value);
    const promises = [];
    if (videoRef.current) {
      promises.push(videoRef.current.setPositionAsync(value));
    }
    if (userVideoRef.current) {
      promises.push(userVideoRef.current.setPositionAsync(value));
    }
    await Promise.all(promises);
    setIsSeeking(false);
  };

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const toggleSyncMode = async () => {
    if (!syncMode) {
      // Entering sync mode - pause both and sync to beginning
      await pauseBothVideos();
      await handleSyncSeek(0);
    }
    setSyncMode(!syncMode);
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
          <Text style={styles.title}>Exercise</Text>
          <View style={styles.placeholder} />
        </View>

        {/* Breadcrumb */}
        <View style={styles.breadcrumb}>
          <TouchableOpacity onPress={() => navigation.navigate('ForgeFitHome')}>
            <Text style={styles.breadcrumbLink}>Home</Text>
          </TouchableOpacity>
          <Text style={styles.breadcrumbSep}> › </Text>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.breadcrumbLink}>{exercise.muscle_name || 'Exercises'}</Text>
          </TouchableOpacity>
          <Text style={styles.breadcrumbSep}> › </Text>
          <Text style={styles.breadcrumbActive}>{exercise.exercise_name}</Text>
        </View>

        {/* Video Section - Side by Side when user video exists */}
        {userVideo ? (
          <View style={styles.comparisonSection}>
            <Text style={styles.comparisonTitle}>COMPARE YOUR FORM</Text>
            <View style={styles.comparisonContainer}>
              {/* Reference Video */}
              <View style={styles.comparisonVideoWrapper}>
                <Text style={styles.comparisonLabel}>Reference</Text>
                <View style={styles.comparisonVideoBox}>
                  {exercise.has_video && videoUrl ? (
                    <Video
                      ref={videoRef}
                      source={{ uri: videoUrl }}
                      style={styles.comparisonVideo}
                      resizeMode={ResizeMode.CONTAIN}
                      isLooping={!syncMode}
                      onPlaybackStatusUpdate={handlePlaybackStatusUpdate}
                    />
                  ) : (
                    <View style={styles.noComparisonVideo}>
                      <Text style={styles.noVideoEmoji}>🎬</Text>
                    </View>
                  )}
                </View>
                {/* Individual Seekbar for Reference Video */}
                {!syncMode && refVideoDuration > 0 && (
                  <View style={styles.individualSeekbarContainer}>
                    <Text style={styles.individualSeekbarTime}>{formatTime(refVideoPosition)}</Text>
                    <Slider
                      style={styles.individualSlider}
                      minimumValue={0}
                      maximumValue={refVideoDuration}
                      value={refVideoPosition}
                      onSlidingStart={() => setIsSeekingRef(true)}
                      onSlidingComplete={handleRefVideoSeek}
                      onValueChange={(value) => { if (isSeekingRef) setRefVideoPosition(value); }}
                      minimumTrackTintColor={colors.accent}
                      maximumTrackTintColor={colors.surface2}
                      thumbTintColor={colors.accent}
                    />
                    <Text style={styles.individualSeekbarTime}>{formatTime(refVideoDuration)}</Text>
                  </View>
                )}
                {/* Individual Play Button for Reference Video */}
                {!syncMode && exercise.has_video && videoUrl && (
                  <TouchableOpacity style={styles.individualPlayButton} onPress={toggleRefVideo}>
                    <Text style={styles.individualPlayIcon}>{isRefVideoPlaying ? '⏸' : '▶'}</Text>
                  </TouchableOpacity>
                )}
              </View>
              
              {/* User Video */}
              <View style={styles.comparisonVideoWrapper}>
                <Text style={styles.comparisonLabel}>Your Form</Text>
                <View style={styles.comparisonVideoBox}>
                  <Video
                    ref={userVideoRef}
                    source={{ uri: userVideo }}
                    style={styles.comparisonVideo}
                    resizeMode={ResizeMode.CONTAIN}
                    isLooping={!syncMode}
                    onPlaybackStatusUpdate={handleUserVideoStatusUpdate}
                  />
                </View>
                {/* Individual Seekbar for User Video */}
                {!syncMode && userVideoDuration > 0 && (
                  <View style={styles.individualSeekbarContainer}>
                    <Text style={styles.individualSeekbarTime}>{formatTime(userVideoPosition)}</Text>
                    <Slider
                      style={styles.individualSlider}
                      minimumValue={0}
                      maximumValue={userVideoDuration}
                      value={userVideoPosition}
                      onSlidingStart={() => setIsSeekingUser(true)}
                      onSlidingComplete={handleUserVideoSeek}
                      onValueChange={(value) => { if (isSeekingUser) setUserVideoPosition(value); }}
                      minimumTrackTintColor={colors.accent}
                      maximumTrackTintColor={colors.surface2}
                      thumbTintColor={colors.accent}
                    />
                    <Text style={styles.individualSeekbarTime}>{formatTime(userVideoDuration)}</Text>
                  </View>
                )}
                {/* Individual Play Button for User Video */}
                {!syncMode && (
                  <TouchableOpacity style={styles.individualPlayButton} onPress={toggleUserVideo}>
                    <Text style={styles.individualPlayIcon}>{isUserVideoPlaying ? '⏸' : '▶'}</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
            
            {/* Sync Mode Toggle */}
            <TouchableOpacity 
              style={[styles.syncModeButton, syncMode && styles.syncModeButtonActive]}
              onPress={toggleSyncMode}
            >
              <Text style={styles.syncModeIcon}>🔗</Text>
              <Text style={[styles.syncModeText, syncMode && styles.syncModeTextActive]}>
                {syncMode ? 'SYNC MODE ON' : 'Enable Sync Mode'}
              </Text>
              <View style={[styles.syncModeIndicator, syncMode && styles.syncModeIndicatorActive]} />
            </TouchableOpacity>

            {/* Unified Seekbar (only when sync mode is on) */}
            {syncMode && syncDuration > 0 && (
              <View style={styles.syncSeekbarContainer}>
                <Text style={styles.seekbarTime}>{formatTime(syncPosition)}</Text>
                <Slider
                  style={styles.slider}
                  minimumValue={0}
                  maximumValue={syncDuration}
                  value={syncPosition}
                  onSlidingStart={() => setIsSeeking(true)}
                  onSlidingComplete={(value) => {
                    handleSyncSeek(value);
                  }}
                  onValueChange={(value) => {
                    if (isSeeking) {
                      setSyncPosition(value);
                    }
                  }}
                  minimumTrackTintColor={colors.accent}
                  maximumTrackTintColor={colors.surface2}
                  thumbTintColor={colors.accent}
                />
                <Text style={styles.seekbarTime}>{formatTime(syncDuration)}</Text>
              </View>
            )}

            {/* Sync Controls */}
            <View style={styles.syncControls}>
              <TouchableOpacity style={styles.syncButton} onPress={restartBothVideos}>
                <Text style={styles.syncButtonIcon}>⟲</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.syncPlayButton, isPlaying && styles.syncPauseButton]} 
                onPress={isPlaying ? pauseBothVideos : playBothVideos}
              >
                <Text style={styles.syncPlayIcon}>{isPlaying ? '⏸' : '▶'}</Text>
                <Text style={styles.syncPlayText}>{isPlaying ? 'Pause' : 'Play Both'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.syncButton} onPress={pauseBothVideos}>
                <Text style={styles.syncButtonIcon}>⏹</Text>
              </TouchableOpacity>
            </View>

            {/* Change/Remove Video */}
            <View style={styles.comparisonActions}>
              <TouchableOpacity style={styles.changeVideoBtn} onPress={handleUploadVideo}>
                <Text style={styles.changeVideoBtnText}>📹 Change Your Video</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.removeVideoBtn} onPress={clearUserVideo}>
                <Text style={styles.removeVideoBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          /* Single Video Player when no user video */
          <View style={styles.singleVideoSection}>
            <View style={styles.videoContainer}>
              {exercise.has_video && videoUrl ? (
                <>
                  <Video
                    ref={videoRef}
                    source={{ uri: videoUrl }}
                    style={styles.video}
                    // @ts-ignore - videoStyle is supported on web
                    videoStyle={Platform.OS === 'web' ? { 
                      width: '100%', 
                      height: '100%',
                      objectFit: 'contain',
                      objectPosition: 'center',
                    } as any : undefined}
                    resizeMode={ResizeMode.CONTAIN}
                    isLooping
                    onPlaybackStatusUpdate={handlePlaybackStatusUpdate}
                    onError={(e) => handleVideoError(String(e))}
                  />
                  {isLoading && (
                    <View style={styles.videoLoading}>
                      <ActivityIndicator size="large" color={colors.accent} />
                      <Text style={styles.loadingText}>Loading video...</Text>
                    </View>
                  )}
                  {error && (
                    <View style={styles.videoError}>
                      <Text style={styles.errorIcon}>⚠️</Text>
                      <Text style={styles.errorText}>{error}</Text>
                      {videoUrl && (
                        <TouchableOpacity 
                          style={styles.openVideoButton}
                          onPress={() => Linking.openURL(videoUrl)}
                        >
                          <Text style={styles.openVideoText}>Open video in browser</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </>
              ) : (
                <View style={styles.noVideo}>
                  <Text style={styles.noVideoIcon}>🎬</Text>
                  <Text style={styles.noVideoText}>No video available</Text>
                  <Text style={styles.noVideoSub}>Video for this exercise hasn't been added yet</Text>
                </View>
              )}
            </View>
            {/* Single Video Controls - Outside container to avoid clipping */}
            {exercise.has_video && videoUrl && refVideoDuration > 0 && (
              <View style={styles.singleVideoControls}>
                <TouchableOpacity style={styles.singlePlayButton} onPress={toggleRefVideo}>
                  <Text style={styles.singlePlayIcon}>{isRefVideoPlaying ? '⏸' : '▶'}</Text>
                </TouchableOpacity>
                <Text style={styles.singleSeekbarTime}>{formatTime(refVideoPosition)}</Text>
                <Slider
                  style={styles.singleSlider}
                  minimumValue={0}
                  maximumValue={refVideoDuration}
                  value={refVideoPosition}
                  onSlidingStart={() => setIsSeekingRef(true)}
                  onSlidingComplete={handleRefVideoSeek}
                  onValueChange={(value) => { if (isSeekingRef) setRefVideoPosition(value); }}
                  minimumTrackTintColor={colors.accent}
                  maximumTrackTintColor={colors.surface2}
                  thumbTintColor={colors.accent}
                />
                <Text style={styles.singleSeekbarTime}>{formatTime(refVideoDuration)}</Text>
              </View>
            )}
          </View>
        )}

        {/* Exercise Info */}
        <View style={styles.infoCard}>
          <Text style={styles.exerciseName}>{exercise.exercise_name}</Text>
          
          <View style={styles.tags}>
            {exercise.muscle_name && (
              <View style={styles.tag}>
                <Text style={styles.tagIcon}>💪</Text>
                <Text style={styles.tagText}>{exercise.muscle_name}</Text>
              </View>
            )}
            {exercise.equipment_type && (
              <View style={styles.tag}>
                <Text style={styles.tagIcon}>🏋️</Text>
                <Text style={styles.tagText}>{exercise.equipment_type}</Text>
              </View>
            )}
          </View>

          {exercise.exercise_url && (
            <TouchableOpacity style={styles.linkButton}>
              <Text style={styles.linkIcon}>🔗</Text>
              <Text style={styles.linkText}>View exercise guide</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Instructions Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>INSTRUCTIONS</Text>
          <View style={styles.instructionsList}>
            <View style={styles.instructionItem}>
              <View style={styles.stepNum}>
                <Text style={styles.stepNumText}>1</Text>
              </View>
              <Text style={styles.instructionText}>
                Set up the equipment as shown in the video
              </Text>
            </View>
            <View style={styles.instructionItem}>
              <View style={styles.stepNum}>
                <Text style={styles.stepNumText}>2</Text>
              </View>
              <Text style={styles.instructionText}>
                Maintain proper form throughout the movement
              </Text>
            </View>
            <View style={styles.instructionItem}>
              <View style={styles.stepNum}>
                <Text style={styles.stepNumText}>3</Text>
              </View>
              <Text style={styles.instructionText}>
                Control the weight on both the lifting and lowering phases
              </Text>
            </View>
          </View>
        </View>

        {/* Tips Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>TIPS</Text>
          <View style={styles.tipCard}>
            <Text style={styles.tipIcon}>💡</Text>
            <Text style={styles.tipText}>
              Focus on muscle contraction rather than lifting heavy weights. 
              Quality reps produce better results than quantity.
            </Text>
          </View>
        </View>

        {/* Upload Section - Only show when no user video */}
        {!userVideo && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>COMPARE YOUR FORM</Text>
            <View style={styles.uploadSection}>
              <TouchableOpacity 
                style={styles.uploadButton}
                onPress={handleUploadVideo}
              >
                <Text style={styles.uploadIcon}>📹</Text>
                <View style={styles.uploadTextContainer}>
                  <Text style={styles.uploadTitle}>Record or Upload Video</Text>
                  <Text style={styles.uploadSubtitle}>Compare your form side-by-side</Text>
                </View>
                <Text style={styles.uploadArrow}>›</Text>
              </TouchableOpacity>

              <View style={styles.uploadOptions}>
                <TouchableOpacity 
                  style={styles.uploadOptionButton}
                  onPress={recordVideo}
                >
                  <Text style={styles.uploadOptionIcon}>🎥</Text>
                  <Text style={styles.uploadOptionText}>Record</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={styles.uploadOptionButton}
                  onPress={pickVideoFromGallery}
                >
                  <Text style={styles.uploadOptionIcon}>📁</Text>
                  <Text style={styles.uploadOptionText}>Gallery</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {/* Start Workout Button */}
        <TouchableOpacity style={styles.startButton}>
          <Text style={styles.startButtonText}>
            {userVideo ? 'ANALYZE WORKOUT' : 'START WORKOUT'}
          </Text>
        </TouchableOpacity>

        <View style={styles.bottomSpacer} />
      </ScrollView>
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
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  backIcon: {
    fontSize: 18,
    color: colors.text,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  placeholder: {
    width: 40,
  },

  // Breadcrumb
  breadcrumb: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
    flexWrap: 'wrap',
  },
  breadcrumbLink: {
    fontSize: 12,
    color: colors.muted,
    fontWeight: '500',
    textDecorationLine: 'underline',
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

  // Video
  singleVideoSection: {
    marginBottom: spacing.lg,
    alignItems: 'center',
  },
  videoContainer: {
    width: '100%',
    aspectRatio: 4 / 3,
    backgroundColor: colors.surface2,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
  },
  video: {
    ...StyleSheet.absoluteFillObject,
  },
  videoLoading: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  loadingText: {
    color: '#fff',
    marginTop: spacing.sm,
    fontSize: 14,
  },
  videoError: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surface2,
  },
  errorIcon: {
    fontSize: 32,
    marginBottom: spacing.sm,
  },
  errorText: {
    color: colors.muted,
    fontSize: 14,
  },
  openVideoButton: {
    marginTop: spacing.md,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
  },
  openVideoText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
  noVideo: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  noVideoIcon: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  noVideoText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  noVideoSub: {
    fontSize: 13,
    color: colors.muted,
    textAlign: 'center',
  },

  // Comparison View
  comparisonSection: {
    marginBottom: spacing.lg,
  },
  comparisonTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.muted,
    letterSpacing: 1,
    marginBottom: spacing.md,
  },
  comparisonContainer: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  comparisonVideoWrapper: {
    flex: 1,
  },
  comparisonLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.accent,
    textAlign: 'center',
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  comparisonVideoBox: {
    aspectRatio: 4 / 3,
    backgroundColor: colors.surface2,
    borderRadius: borderRadius.md,
    overflow: 'hidden',
  },
  comparisonVideo: {
    width: '100%',
    height: '100%',
  },
  noComparisonVideo: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  noVideoEmoji: {
    fontSize: 32,
  },
  syncControls: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  syncButton: {
    width: 44,
    height: 44,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  syncButtonIcon: {
    fontSize: 18,
  },
  syncPlayButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    gap: spacing.xs,
  },
  syncPlayIcon: {
    fontSize: 14,
    color: '#fff',
  },
  syncPlayText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  syncPauseButton: {
    backgroundColor: colors.muted,
  },

  // Sync Mode Toggle
  syncModeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  syncModeButtonActive: {
    backgroundColor: colors.accent + '20',
    borderColor: colors.accent,
  },
  syncModeIcon: {
    fontSize: 16,
  },
  syncModeText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
  },
  syncModeTextActive: {
    color: colors.accent,
    fontWeight: '700',
  },
  syncModeIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.muted,
  },
  syncModeIndicatorActive: {
    backgroundColor: colors.green,
  },

  // Seekbar
  syncSeekbarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.md,
    paddingHorizontal: spacing.xs,
    gap: spacing.sm,
  },
  slider: {
    flex: 1,
    height: 40,
  },
  // Individual video seekbars
  individualSeekbarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
    gap: 2,
  },
  individualSlider: {
    flex: 1,
    height: 30,
  },
  individualSeekbarTime: {
    fontSize: 9,
    fontWeight: '600',
    color: colors.muted,
    width: 28,
    textAlign: 'center',
  },
  individualPlayButton: {
    alignSelf: 'center',
    backgroundColor: colors.accent,
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  individualPlayIcon: {
    fontSize: 12,
    color: '#fff',
  },
  // Single video controls (before user uploads)
  singleVideoControls: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xs,
    gap: spacing.sm,
  },
  singlePlayButton: {
    backgroundColor: colors.accent,
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  singlePlayIcon: {
    fontSize: 16,
    color: '#fff',
  },
  singleSlider: {
    flex: 1,
    height: 40,
  },
  singleSeekbarTime: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.muted,
    width: 45,
    textAlign: 'center',
  },
  seekbarTime: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted,
    width: 40,
    textAlign: 'center',
  },
  seekbarTrack: {
    flex: 1,
    height: 30,
    justifyContent: 'center',
  },
  seekbarTouchable: {
    flex: 1,
    height: 30,
    justifyContent: 'center',
  },
  seekbarBackground: {
    height: 6,
    backgroundColor: colors.surface2,
    borderRadius: 3,
    position: 'relative',
  },
  seekbarProgress: {
    height: '100%',
    backgroundColor: colors.accent,
    borderRadius: 3,
  },
  seekbarThumb: {
    position: 'absolute',
    top: -5,
    width: 16,
    height: 16,
    backgroundColor: colors.accent,
    borderRadius: 8,
    marginLeft: -8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
  },

  comparisonActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  changeVideoBtn: {
    flex: 1,
    backgroundColor: colors.surface,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  changeVideoBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  removeVideoBtn: {
    width: 40,
    height: 40,
    backgroundColor: '#ff4444',
    borderRadius: borderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  removeVideoBtnText: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '700',
  },

  // Info Card
  infoCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  exerciseName: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.text,
    marginBottom: spacing.md,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.pill,
    gap: spacing.xs,
  },
  tagIcon: {
    fontSize: 14,
  },
  tagText: {
    fontSize: 13,
    color: colors.text,
    fontWeight: '500',
  },
  linkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  linkIcon: {
    fontSize: 14,
  },
  linkText: {
    fontSize: 13,
    color: colors.accent,
    fontWeight: '600',
  },

  // Section
  section: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.muted,
    letterSpacing: 1,
    marginBottom: spacing.md,
  },
  instructionsList: {
    gap: spacing.md,
  },
  instructionItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  stepNum: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepNumText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  instructionText: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
    lineHeight: 20,
  },

  // Tips
  tipCard: {
    flexDirection: 'row',
    backgroundColor: colors.accent + '15',
    padding: spacing.md,
    borderRadius: borderRadius.md,
    gap: spacing.sm,
  },
  tipIcon: {
    fontSize: 18,
  },
  tipText: {
    flex: 1,
    fontSize: 13,
    color: colors.text,
    lineHeight: 18,
  },

  // Start Button
  startButton: {
    backgroundColor: colors.accent,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  startButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 1,
  },

  // Upload Section
  uploadSection: {
    gap: spacing.md,
  },
  uploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    padding: spacing.lg,
    borderRadius: borderRadius.lg,
    borderWidth: 2,
    borderColor: colors.accent,
    borderStyle: 'dashed',
  },
  uploadIcon: {
    fontSize: 32,
    marginRight: spacing.md,
  },
  uploadTextContainer: {
    flex: 1,
  },
  uploadTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 2,
  },
  uploadSubtitle: {
    fontSize: 12,
    color: colors.muted,
  },
  uploadArrow: {
    fontSize: 24,
    color: colors.accent,
  },
  uploadOptions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  uploadOptionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface2,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    gap: spacing.sm,
  },
  uploadOptionIcon: {
    fontSize: 18,
  },
  uploadOptionText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },

  // User Video
  userVideoContainer: {
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    backgroundColor: colors.surface2,
  },
  userVideo: {
    width: '100%',
    height: VIDEO_HEIGHT,
  },
  userVideoActions: {
    flexDirection: 'row',
    padding: spacing.sm,
    gap: spacing.sm,
  },
  changeVideoButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    gap: spacing.xs,
  },
  changeVideoIcon: {
    fontSize: 14,
  },
  changeVideoText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  removeVideoButton: {
    width: 36,
    height: 36,
    backgroundColor: '#ff4444',
    borderRadius: borderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  removeVideoIcon: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '700',
  },

  bottomSpacer: {
    height: spacing.xxl,
  },
});
