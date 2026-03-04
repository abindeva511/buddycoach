import React, { useState, useRef, useEffect, useCallback } from 'react';
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
  TextInput,
  PanResponder,
} from 'react-native';
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import Slider from '@react-native-community/slider';
import { colors, spacing, borderRadius } from '../theme/forgefit';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { exerciseApi } from '../api/api';
import api from '../api/api';

type Props = NativeStackScreenProps<RootStackParamList, 'ExerciseDetail'>;

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const VIDEO_HEIGHT = (SCREEN_WIDTH * 9) / 16; // 16:9 aspect ratio

// ─── Zoom + Pan hook ────────────────────────────────────────────────────────
const ZOOM_MIN = 1;
const ZOOM_MAX = 3;

function useZoomPan() {
  const containerRef = useRef<any>(null);  // outer box (overflow:hidden)
  const wrapperRef   = useRef<any>(null);  // inner wrapper – transform target
  const stateRef     = useRef({ s: 1, x: 0, y: 0, r: 0 });
  const dragRef      = useRef({ active: false, lastX: 0, lastY: 0 });
  const pinchRef     = useRef({ active: false, startDist: 0, startAngle: 0,
                                startS: 1, startR: 0, startX: 0, startY: 0 });
  const singlePanRef = useRef({ lastX: 0, lastY: 0 });
  const [displayScale,    setDisplayScale]    = useState(1);
  const [displayRotation, setDisplayRotation] = useState(0);
  const [gestureActive,   setGestureActive]   = useState(false);

  const commit = useCallback((s: number, x: number, y: number, r?: number) => {
    const el = containerRef.current;
    const w  = el ? (el.offsetWidth  || 300) : 300;
    const h  = el ? (el.offsetHeight || 225) : 225;
    const rot = r !== undefined ? r : stateRef.current.r;
    // Loosen bounds when rotated 90/270 (content w/h swapped)
    const rotNorm = ((rot % 360) + 360) % 360;
    const swapped = rotNorm === 90 || rotNorm === 270;
    const bw = swapped ? h : w;
    const bh = swapped ? w : h;
    const maxX = bw * (s - 1) / 2;
    const maxY = bh * (s - 1) / 2;
    const cx = s <= 1 ? 0 : Math.min(maxX, Math.max(-maxX, x));
    const cy = s <= 1 ? 0 : Math.min(maxY, Math.max(-maxY, y));
    stateRef.current = { s, x: cx, y: cy, r: rot };
    const wrapper = wrapperRef.current;
    if (wrapper) {
      if (Platform.OS === 'web') {
        wrapper.style.transform       = `translate(${cx}px, ${cy}px) rotate(${rot}deg) scale(${s})`;
        wrapper.style.transformOrigin = '50% 50%';
        wrapper.style.willChange      = 'transform';
      } else {
        wrapper.setNativeProps({
          style: {
            transform: [
              { translateX: cx },
              { translateY: cy },
              { rotate: `${rot}deg` },
              { scale: s },
            ],
          },
        });
      }
    }
    if (el && Platform.OS === 'web') {
      el.style.cursor = s > 1 ? (dragRef.current.active ? 'grabbing' : 'grab') : 'default';
    }
    setDisplayScale(Math.round(s * 100) / 100);
    setDisplayRotation(Math.round(((rot % 360) + 360) % 360));
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const container = containerRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return; // trackpad pinch = wheel + ctrlKey
      e.preventDefault();
      e.stopPropagation();
      const rect = container.getBoundingClientRect();
      const w = container.offsetWidth  || rect.width;
      const h = container.offsetHeight || rect.height;
      // cursor offset relative to container centre
      const dx = e.clientX - rect.left - w / 2;
      const dy = e.clientY - rect.top  - h / 2;
      const { s: os, x: ox, y: oy } = stateRef.current;
      const factor = e.deltaY < 0 ? 1.08 : 0.93;
      const ns     = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, os * factor));
      const ratio  = ns / os;
      // keep the point under the cursor stationary
      commit(ns, dx - (dx - ox) * ratio, dy - (dy - oy) * ratio);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (stateRef.current.s <= 1) return;
      // Don't start drag when clicking the zoom buttons
      const target = e.target as HTMLElement;
      if (target.closest && target.closest('[data-zoom-overlay]')) return;
      dragRef.current = { active: true, lastX: e.clientX, lastY: e.clientY };
      // Use document-level events for drag so buttons don't get blocked by setPointerCapture
      const onDocMove = (ev: PointerEvent) => {
        if (!dragRef.current.active) return;
        const { s, x, y } = stateRef.current;
        commit(s, x + ev.clientX - dragRef.current.lastX, y + ev.clientY - dragRef.current.lastY);
        dragRef.current.lastX = ev.clientX;
        dragRef.current.lastY = ev.clientY;
      };
      const onDocUp = () => {
        dragRef.current.active = false;
        container.style.cursor = stateRef.current.s > 1 ? 'grab' : 'default';
        document.removeEventListener('pointermove', onDocMove);
        document.removeEventListener('pointerup',   onDocUp);
      };
      document.addEventListener('pointermove', onDocMove);
      document.addEventListener('pointerup',   onDocUp);
      container.style.cursor = 'grabbing';
    };

    // Two-finger touch: pinch-zoom + twist-rotate
    const ts = { active: false, startAngle: 0, startR: 0, startDist: 0, startS: 0, startX: 0, startY: 0 };
    const tAngle = (a: Touch, b: Touch) =>
      Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX) * 180 / Math.PI;
    const tDist = (a: Touch, b: Touch) =>
      Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      e.preventDefault();
      const [t1, t2] = [e.touches[0], e.touches[1]];
      ts.active     = true;
      ts.startAngle = tAngle(t1, t2);
      ts.startDist  = tDist(t1, t2);
      ts.startR     = stateRef.current.r;
      ts.startS     = stateRef.current.s;
      ts.startX     = stateRef.current.x;
      ts.startY     = stateRef.current.y;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!ts.active || e.touches.length !== 2) return;
      e.preventDefault();
      const [t1, t2] = [e.touches[0], e.touches[1]];
      const nr = ts.startR + tAngle(t1, t2) - ts.startAngle;
      const ns = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, ts.startS * tDist(t1, t2) / ts.startDist));
      commit(ns, ts.startX, ts.startY, nr);
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) ts.active = false;
    };

    container.addEventListener('wheel',       onWheel,       { passive: false });
    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('touchstart',  onTouchStart,  { passive: false });
    container.addEventListener('touchmove',   onTouchMove,   { passive: false });
    container.addEventListener('touchend',    onTouchEnd);
    return () => {
      container.removeEventListener('wheel',       onWheel);
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('touchstart',  onTouchStart);
      container.removeEventListener('touchmove',   onTouchMove);
      container.removeEventListener('touchend',    onTouchEnd);
    };
  }, [commit]);

  const zoomIn  = useCallback(() => {
    const { s, x, y } = stateRef.current;
    commit(Math.min(ZOOM_MAX, parseFloat((s + 0.25).toFixed(2))), x, y);
  }, [commit]);

  const zoomOut = useCallback(() => {
    const { s, x, y } = stateRef.current;
    commit(Math.max(ZOOM_MIN, parseFloat((s - 0.25).toFixed(2))), x, y);
  }, [commit]);

  const rotateLeft = useCallback(() => {
    const { s, x, y, r } = stateRef.current;
    commit(s, x, y, r - 90);
  }, [commit]);

  const rotateRight = useCallback(() => {
    const { s, x, y, r } = stateRef.current;
    commit(s, x, y, r + 90);
  }, [commit]);

  const rotateBy = useCallback((angle: number) => {
    const { s, x, y } = stateRef.current;
    commit(s, x, y, angle);
  }, [commit]);

  const reset = useCallback(() => {
    commit(1, 0, 0, 0);
  }, [commit]);

  // Native gesture: pinch-zoom + twist-rotate + single-finger pan
  const commitRef = useRef(commit);
  useEffect(() => { commitRef.current = commit; }, [commit]);

  const panResponder = useRef(
    PanResponder.create({
      // Only claim the responder when 2+ fingers touch (lets single-finger scroll the page)
      onStartShouldSetPanResponder:        (evt) => evt.nativeEvent.touches.length >= 2,
      onStartShouldSetPanResponderCapture: ()    => false,
      onMoveShouldSetPanResponder:         (evt) =>
        evt.nativeEvent.touches.length >= 2 || stateRef.current.s > 1,
      onMoveShouldSetPanResponderCapture:  ()    => false,
      onPanResponderGrant: (evt) => {
        const touches = evt.nativeEvent.touches;
        setGestureActive(true);   // disable parent ScrollView while we handle the gesture
        if (touches.length >= 2) {
          const [t1, t2] = [touches[0], touches[1]];
          pinchRef.current = {
            active: true,
            startDist:  Math.hypot(t2.pageX - t1.pageX, t2.pageY - t1.pageY),
            startAngle: Math.atan2(t2.pageY - t1.pageY, t2.pageX - t1.pageX) * 180 / Math.PI,
            startS: stateRef.current.s,
            startR: stateRef.current.r,
            startX: stateRef.current.x,
            startY: stateRef.current.y,
          };
        } else {
          pinchRef.current.active = false;
          singlePanRef.current = { lastX: touches[0].pageX, lastY: touches[0].pageY };
        }
      },
      onPanResponderMove: (evt) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2) {
          const [t1, t2] = [touches[0], touches[1]];
          const p = pinchRef.current;
          if (!p.active) return;
          const curDist  = Math.hypot(t2.pageX - t1.pageX, t2.pageY - t1.pageY);
          const curAngle = Math.atan2(t2.pageY - t1.pageY, t2.pageX - t1.pageX) * 180 / Math.PI;
          const ns = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, p.startS * curDist / p.startDist));
          const nr = p.startR + curAngle - p.startAngle;
          commitRef.current(ns, p.startX, p.startY, nr);
        } else if (touches.length === 1 && !pinchRef.current.active && stateRef.current.s > 1) {
          const t = touches[0];
          const { s, x, y } = stateRef.current;
          commitRef.current(
            s,
            x + t.pageX - singlePanRef.current.lastX,
            y + t.pageY - singlePanRef.current.lastY,
          );
          singlePanRef.current = { lastX: t.pageX, lastY: t.pageY };
        }
      },
      onPanResponderRelease:   () => { setGestureActive(false); pinchRef.current.active = false; },
      onPanResponderTerminate: () => { setGestureActive(false); pinchRef.current.active = false; },
    })
  ).current;

  const panHandlers = Platform.OS !== 'web' ? panResponder.panHandlers : {};

  return { containerRef, wrapperRef, displayScale, displayRotation,
           zoomIn, zoomOut, rotateLeft, rotateRight, rotateBy,
           panHandlers, gestureActive, reset };
}
// ─── Rotate Overlay (bottom-left) ────────────────────────────────────────────
type RotateOverlayProps = {
  zp: ReturnType<typeof useZoomPan>;
  editValue: string | null;
  onStartEdit: () => void;
  onChangeText: (v: string) => void;
  onCommitEdit: () => void;
};
function RotateOverlay({ zp, editValue, onStartEdit, onChangeText, onCommitEdit }: RotateOverlayProps) {
  const rot = Math.round(((zp.displayRotation % 360) + 360) % 360);
  const label = `${rot}°`;
  return (
    // @ts-ignore
    <View style={roStyles.rotateOverlay} data-zoom-overlay="1">
      <TouchableOpacity style={roStyles.rotBtn} onPress={zp.rotateLeft}>
        <Text style={roStyles.rotBtnText}>↺</Text>
      </TouchableOpacity>
      {editValue !== null ? (
        <TextInput
          style={roStyles.rotInput}
          value={editValue}
          onChangeText={onChangeText}
          onBlur={onCommitEdit}
          onSubmitEditing={onCommitEdit}
          keyboardType="numbers-and-punctuation"
          autoFocus
          selectTextOnFocus
          maxLength={6}
        />
      ) : (
        <TouchableOpacity onPress={onStartEdit}>
          <Text style={roStyles.rotLabel}>{label}</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity style={roStyles.rotBtn} onPress={zp.rotateRight}>
        <Text style={roStyles.rotBtnText}>↻</Text>
      </TouchableOpacity>
    </View>
  );
}
const roStyles = StyleSheet.create({
  rotateOverlay: {
    position: 'absolute' as const,
    bottom: 8,
    left: 8,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: 'rgba(0,0,0,0.60)',
    borderRadius: 22,
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 4,
  },
  rotBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.18)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  rotBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700' as const,
    lineHeight: 20,
  },
  rotLabel: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600' as const,
    minWidth: 32,
    textAlign: 'center' as const,
  },
  rotInput: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600' as const,
    minWidth: 44,
    textAlign: 'center' as const,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.5)',
    paddingVertical: 0,
    paddingHorizontal: 2,
  },
});
// ────────────────────────────────────────────────────────────────────────────

export default function ExerciseDetailScreen({ navigation, route }: Props) {
  const { exercise } = route.params;
  const videoRef = useRef<Video>(null);
  const userVideoRef = useRef<Video>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userVideo, setUserVideo] = useState<string | null>(null);
  const [userVideoFile, setUserVideoFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [analyzeStep, setAnalyzeStep] = useState<string | null>(null);
  // Web-only hidden file input ref
  const webFileInputRef = useRef<HTMLInputElement | null>(null);

  // Create hidden file input on web
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/*';
    input.style.display = 'none';
    input.onchange = (e: Event) => {
      const target = e.target as HTMLInputElement;
      const file = target.files?.[0];
      if (file) {
        setUserVideoFile(file);
        setUserVideo(URL.createObjectURL(file));
      }
      // Reset so same file can be picked again
      target.value = '';
    };
    document.body.appendChild(input);
    webFileInputRef.current = input;
    return () => {
      document.body.removeChild(input);
    };
  }, []);
  
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

  // Zoom + pan hook instances (one per video surface)
  const refZP    = useZoomPan();
  const userZP   = useZoomPan();
  const singleZP = useZoomPan();

  // Angle editing state (null = not editing, string = editing)
  const [refAngleEdit,    setRefAngleEdit]    = useState<string | null>(null);
  const [userAngleEdit,   setUserAngleEdit]   = useState<string | null>(null);
  const [singleAngleEdit, setSingleAngleEdit] = useState<string | null>(null);

  const makeAngleHandlers = (
    zp: ReturnType<typeof useZoomPan>,
    setEdit: React.Dispatch<React.SetStateAction<string | null>>,
  ) => ({
    onStartEdit: () => setEdit(String(Math.round(((zp.displayRotation % 360) + 360) % 360))),
    onChangeText: (v: string) => setEdit(v),
    onCommitEdit: () => {
      setEdit(prev => {
        if (prev === null) return null;
        const n = parseFloat(prev);
        if (!isNaN(n)) zp.rotateBy(n);
        return null;
      });
    },
  });

  const videoUrl = exercise.has_video ? exercise.video_url : null;

  // Debug log
  const handlePlaybackStatusUpdate = (status: AVPlaybackStatus) => {
    if (status.isLoaded) {
      setIsLoading(prev  => prev  ? false : prev);
      setIsPlaying(prev  => prev  !== status.isPlaying ? status.isPlaying : prev);
      setIsRefVideoPlaying(prev => prev !== status.isPlaying ? status.isPlaying : prev);
      if (status.durationMillis) {
        setRefVideoDuration(prev => prev !== status.durationMillis ? status.durationMillis! : prev);
      }
      if (syncMode && !isSeeking && status.positionMillis !== undefined) {
        setSyncPosition(status.positionMillis);
      }
      if (!isSeekingRef && status.positionMillis !== undefined) {
        setRefVideoPosition(status.positionMillis);
      }
    }
  };

  const handleUserVideoStatusUpdate = (status: AVPlaybackStatus) => {
    if (status.isLoaded) {
      setIsUserVideoPlaying(prev => prev !== status.isPlaying ? status.isPlaying : prev);
      if (status.durationMillis) {
        setUserVideoDuration(prev => prev !== status.durationMillis ? status.durationMillis! : prev);
      }
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
    // On web, use the hidden native file input for a reliable File object
    if (Platform.OS === 'web') {
      webFileInputRef.current?.click();
      return;
    }
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
      setUserVideoFile(null);
    }
  };

  const recordVideo = async () => {
    // Camera recording not supported on web — fall back to file picker
    if (Platform.OS === 'web') {
      webFileInputRef.current?.click();
      return;
    }
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
      setUserVideoFile(null);
    }
  };

  const analyzeWorkout = async () => {
    if (!userVideo) return;
    if (Platform.OS === 'web' && !userVideoFile) {
      setAnalyzeError('Please re-select your video using the Change Your Video button before analyzing.');
      return;
    }
    setIsUploading(true);
    setAnalyzeError(null);
    setAnalyzeStep('Preparing video...');
    try {
      // Build FormData with the user's video
      const formData = new FormData();
      if (Platform.OS === 'web') {
        // userVideoFile is always set on web (from hidden input)
        formData.append('file', userVideoFile!, userVideoFile!.name || 'workout.mp4');
      } else {
        const filename = userVideo.split('/').pop() ?? 'workout.mp4';
        formData.append('file', {
          uri: userVideo,
          name: filename,
          type: 'video/mp4',
        } as any);
      }

      // Step 1: upload video file
      setAnalyzeStep('Uploading video...');
      console.log('[analyzeWorkout] uploading video...');
      const uploadRes = await api.post('/api/v1/files', formData);
      console.log('[analyzeWorkout] upload ok, file_id=', uploadRes.data.id);

      // Step 2: trigger 3D pose estimation
      setAnalyzeStep('Running pose analysis...');
      console.log('[analyzeWorkout] starting pose3d analysis...');
      const analysisRes = await api.post('/api/v1/analysis/pose3d', {
        file_id: uploadRes.data.id,
      });
      console.log('[analyzeWorkout] analysis ok', analysisRes.data);

      // Navigate to result screen
      setAnalyzeStep(null);
      navigation.navigate('Result', { result: analysisRes.data });
    } catch (e: any) {
      const status = e.response?.status;
      const detail = e.response?.data?.detail ?? e.response?.data?.message;
      const msg = status
        ? `HTTP ${status}: ${detail ?? JSON.stringify(e.response?.data ?? '')}`
        : (e.message ?? 'Something went wrong');
      console.error('[analyzeWorkout] full error:', {
        message: e.message,
        status: e.response?.status,
        data: e.response?.data,
        config_url: e.config?.url,
        stack: e.stack,
      });
      setAnalyzeError(`[${analyzeStep ?? 'init'}] ${msg}`);
      setAnalyzeStep(null);
    } finally {
      setIsUploading(false);
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
        scrollEnabled={!refZP.gestureActive && !userZP.gestureActive && !singleZP.gestureActive}
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
                <View ref={refZP.containerRef} style={styles.comparisonVideoBox} {...refZP.panHandlers}>
                  <View ref={refZP.wrapperRef} style={styles.zoomWrapper}>
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
                  {exercise.has_video && videoUrl && (
                    // @ts-ignore
                    <View style={styles.zoomOverlay} data-zoom-overlay="1">
                      <TouchableOpacity
                        style={[styles.zoomBtn, refZP.displayScale <= ZOOM_MIN && styles.zoomBtnDisabled]}
                        onPress={refZP.zoomOut}
                        disabled={refZP.displayScale <= ZOOM_MIN}
                      >
                        <Text style={styles.zoomBtnText}>−</Text>
                      </TouchableOpacity>
                      <Text style={styles.zoomLabel}>{Math.round(refZP.displayScale * 100)}%</Text>
                      <TouchableOpacity
                        style={[styles.zoomBtn, refZP.displayScale >= ZOOM_MAX && styles.zoomBtnDisabled]}
                        onPress={refZP.zoomIn}
                        disabled={refZP.displayScale >= ZOOM_MAX}
                      >
                        <Text style={styles.zoomBtnText}>+</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  {exercise.has_video && videoUrl && (
                    <RotateOverlay
                      zp={refZP}
                      editValue={refAngleEdit}
                      {...makeAngleHandlers(refZP, setRefAngleEdit)}
                    />
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
                <View ref={userZP.containerRef} style={styles.comparisonVideoBox} {...userZP.panHandlers}>
                  <View ref={userZP.wrapperRef} style={styles.zoomWrapper}>
                    <Video
                      ref={userVideoRef}
                      source={{ uri: userVideo }}
                      style={styles.comparisonVideo}
                      resizeMode={ResizeMode.CONTAIN}
                      isLooping={!syncMode}
                      onPlaybackStatusUpdate={handleUserVideoStatusUpdate}
                    />
                  </View>
                  // @ts-ignore
                  <View style={styles.zoomOverlay} data-zoom-overlay="1">
                    <TouchableOpacity
                      style={[styles.zoomBtn, userZP.displayScale <= ZOOM_MIN && styles.zoomBtnDisabled]}
                      onPress={userZP.zoomOut}
                      disabled={userZP.displayScale <= ZOOM_MIN}
                    >
                      <Text style={styles.zoomBtnText}>−</Text>
                    </TouchableOpacity>
                    <Text style={styles.zoomLabel}>{Math.round(userZP.displayScale * 100)}%</Text>
                    <TouchableOpacity
                      style={[styles.zoomBtn, userZP.displayScale >= ZOOM_MAX && styles.zoomBtnDisabled]}
                      onPress={userZP.zoomIn}
                      disabled={userZP.displayScale >= ZOOM_MAX}
                    >
                      <Text style={styles.zoomBtnText}>+</Text>
                    </TouchableOpacity>
                  </View>
                  <RotateOverlay
                    zp={userZP}
                    editValue={userAngleEdit}
                    {...makeAngleHandlers(userZP, setUserAngleEdit)}
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

            {/* Change/Remove/StartOver Video */}
            <View style={styles.comparisonActions}>
              <TouchableOpacity
                style={styles.startOverBtn}
                onPress={() => { clearUserVideo(); refZP.reset(); userZP.reset(); singleZP.reset(); }}
              >
                <Text style={styles.startOverBtnText}>🔄 Start Over</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.changeVideoBtn} onPress={handleUploadVideo}>
                <Text style={styles.changeVideoBtnText}>📹 Change</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.removeVideoBtn} onPress={clearUserVideo}>
                <Text style={styles.removeVideoBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          /* Single Video Player when no user video */
          <View style={styles.singleVideoSection}>
            <View ref={singleZP.containerRef} style={styles.videoContainer} {...singleZP.panHandlers}>
              {exercise.has_video && videoUrl ? (
                <>
                  <View ref={singleZP.wrapperRef} style={styles.zoomWrapper}>
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
                  </View>
                  // @ts-ignore
                  <View style={styles.zoomOverlay} data-zoom-overlay="1">
                    <TouchableOpacity
                      style={[styles.zoomBtn, singleZP.displayScale <= ZOOM_MIN && styles.zoomBtnDisabled]}
                      onPress={singleZP.zoomOut}
                      disabled={singleZP.displayScale <= ZOOM_MIN}
                    >
                      <Text style={styles.zoomBtnText}>−</Text>
                    </TouchableOpacity>
                    <Text style={styles.zoomLabel}>{Math.round(singleZP.displayScale * 100)}%</Text>
                    <TouchableOpacity
                      style={[styles.zoomBtn, singleZP.displayScale >= ZOOM_MAX && styles.zoomBtnDisabled]}
                      onPress={singleZP.zoomIn}
                      disabled={singleZP.displayScale >= ZOOM_MAX}
                    >
                      <Text style={styles.zoomBtnText}>+</Text>
                    </TouchableOpacity>
                  </View>
                  <RotateOverlay
                    zp={singleZP}
                    editValue={singleAngleEdit}
                    {...makeAngleHandlers(singleZP, setSingleAngleEdit)}
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
            {/* Start Over for single video view */}
            {exercise.has_video && videoUrl && (
              <TouchableOpacity
                style={[styles.startOverBtn, { marginTop: 10, marginHorizontal: 0 }]}
                onPress={() => { singleZP.reset(); videoRef.current?.replayAsync(); }}
              >
                <Text style={styles.startOverBtnText}>🔄 Start Over</Text>
              </TouchableOpacity>
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

        {/* Analyze step progress */}
        {analyzeStep && (
          <View style={[styles.analyzeErrorBox, { backgroundColor: '#1a3a5c', borderColor: '#2a6496' }]}>
            <ActivityIndicator color="#fff" size="small" style={{ marginRight: 8 }} />
            <Text style={[styles.analyzeErrorText, { color: '#a8d4f5' }]}>{analyzeStep}</Text>
          </View>
        )}

        {/* Analyze error */}
        {analyzeError && (
          <View style={styles.analyzeErrorBox}>
            <Text style={styles.analyzeErrorText}>⚠️ {analyzeError}</Text>
          </View>
        )}

        {/* Start Workout Button */}
        <TouchableOpacity
          style={[styles.startButton, isUploading && { opacity: 0.7 }]}
          onPress={userVideo ? analyzeWorkout : togglePlayback}
          disabled={isUploading}
        >
          {isUploading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.startButtonText}>
              {userVideo ? 'ANALYZE WORKOUT' : 'START WORKOUT'}
            </Text>
          )}
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
    marginBottom: spacing.md,
  },
  comparisonVideoWrapper: {
    flex: 1,
    minHeight: 220,
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
    height: VIDEO_HEIGHT,
    backgroundColor: colors.surface2,
    borderRadius: borderRadius.md,
    overflow: 'hidden',
  },
  comparisonVideo: {
    width: '100%',
    height: '100%',
    resizeMode: 'contain',
  },
  noComparisonVideo: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  noVideoEmoji: {
    fontSize: 32,
  },

  // Zoom wrapper — full-size inner container that receives the CSS transform
  zoomWrapper: {
    width: '100%',
    height: '100%',
  },

  // Zoom controls overlay
  zoomOverlay: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.60)',
    borderRadius: 22,
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 3,
  },
  zoomBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.18)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  zoomBtnDisabled: {
    opacity: 0.3,
  },
  zoomBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 20,
  },
  zoomLabel: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
    minWidth: 34,
    textAlign: 'center',
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
  startOverBtn: {
    flex: 1,
    backgroundColor: 'rgba(255,80,80,0.12)',
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,80,80,0.35)',
  },
  startOverBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#ff5050',
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
  analyzeErrorBox: {
    backgroundColor: '#2d1010',
    borderRadius: 10,
    padding: 12,
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: '#ff5252',
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  analyzeErrorText: {
    color: '#ff5252',
    fontSize: 13,
    textAlign: 'center',
  },
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
