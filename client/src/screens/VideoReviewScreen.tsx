import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  Dimensions,
  ActivityIndicator,
  Platform,
  Alert,
  ScrollView,
  TextInput,
  PanResponder,
} from 'react-native';
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import Slider from '@react-native-community/slider';
import { colors, spacing, borderRadius } from '../theme/forgefit';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import api from '../api/api';

type Props = NativeStackScreenProps<RootStackParamList, 'VideoReview'>;

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
// Each video takes roughly half the screen width with some padding
const SIDE_PADDING = spacing.lg * 2;
const GAP = spacing.md;
const VIDEO_CONTAINER_WIDTH = (SCREEN_WIDTH - SIDE_PADDING - GAP) / 2;

// ─── Zoom + Pan hook ────────────────────────────────────────────────────────
const ZOOM_MIN = 1;
const ZOOM_MAX = 3;

function useZoomPan() {
  const containerRef = useRef<any>(null);
  const wrapperRef   = useRef<any>(null);
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
      if (!e.ctrlKey) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = container.getBoundingClientRect();
      const w = container.offsetWidth  || rect.width;
      const h = container.offsetHeight || rect.height;
      const dx = e.clientX - rect.left - w / 2;
      const dy = e.clientY - rect.top  - h / 2;
      const { s: os, x: ox, y: oy } = stateRef.current;
      const factor = e.deltaY < 0 ? 1.08 : 0.93;
      const ns     = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, os * factor));
      const ratio  = ns / os;
      commit(ns, dx - (dx - ox) * ratio, dy - (dy - oy) * ratio);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (stateRef.current.s <= 1) return;
      const target = e.target as HTMLElement;
      if (target.closest && target.closest('[data-zoom-overlay]')) return;
      dragRef.current = { active: true, lastX: e.clientX, lastY: e.clientY };
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

  const commitRef = useRef(commit);
  useEffect(() => { commitRef.current = commit; }, [commit]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder:        (evt) => evt.nativeEvent.touches.length >= 2,
      onStartShouldSetPanResponderCapture: ()    => false,
      onMoveShouldSetPanResponder:         (evt) =>
        evt.nativeEvent.touches.length >= 2 || stateRef.current.s > 1,
      onMoveShouldSetPanResponderCapture:  ()    => false,
      onPanResponderGrant: (evt) => {
        const touches = evt.nativeEvent.touches;
        setGestureActive(true);
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

export default function VideoReviewScreen({ navigation, route }: Props) {
  const { videoUri, videoFile, exercise } = route.params;
  
  const [userVideo, setUserVideo] = useState<string>(videoUri);
  const [userVideoFile, setUserVideoFile] = useState<File | null>(videoFile || null);
  const [isUserVideoLoading, setIsUserVideoLoading] = useState(true);
  const [isRefVideoLoading, setIsRefVideoLoading] = useState(true);
  
  // Analysis state
  const [isUploading, setIsUploading] = useState(false);
  const [analyzeStep, setAnalyzeStep] = useState<string | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  
  // Sync mode state
  const [syncMode, setSyncMode] = useState(false);
  const [syncPosition, setSyncPosition] = useState(0);
  const [syncDuration, setSyncDuration] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  
  // Individual video state
  const [refVideoDuration, setRefVideoDuration] = useState(0);
  const [userVideoDuration, setUserVideoDuration] = useState(0);
  const [refVideoPosition, setRefVideoPosition] = useState(0);
  const [userVideoPosition, setUserVideoPosition] = useState(0);
  const [isSeekingRef, setIsSeekingRef] = useState(false);
  const [isSeekingUser, setIsSeekingUser] = useState(false);
  const [isRefVideoPlaying, setIsRefVideoPlaying] = useState(false);
  const [isUserVideoPlaying, setIsUserVideoPlaying] = useState(false);
  
  // Zoom/pan hooks for each video
  const refZP = useZoomPan();
  const userZP = useZoomPan();
  
  // Angle editing state
  const [refAngleEdit, setRefAngleEdit] = useState<string | null>(null);
  const [userAngleEdit, setUserAngleEdit] = useState<string | null>(null);
  
  const userVideoRef = useRef<Video>(null);
  const refVideoRef = useRef<Video>(null);
  const webFileInputRef = useRef<HTMLInputElement>(null);
  
  // Reference video URL from exercise
  const referenceVideoUrl = exercise.video_url;

  // Angle edit handlers factory
  const makeAngleHandlers = (
    zp: ReturnType<typeof useZoomPan>,
    setEdit: React.Dispatch<React.SetStateAction<string | null>>,
  ) => ({
    onStartEdit: () => setEdit(String(zp.displayRotation)),
    onChangeText: (v: string) => setEdit(v),
    onCommitEdit: () => {
      setEdit((current) => {
        const n = parseFloat(current ?? '');
        if (!isNaN(n)) zp.rotateBy(n);
        return null;
      });
    },
  });

  // Web file input for changing video
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'video/*';
      input.style.display = 'none';
      input.onchange = (e: any) => {
        const file = e.target?.files?.[0];
        if (file) {
          setUserVideoFile(file);
          setUserVideo(URL.createObjectURL(file));
        }
      };
      document.body.appendChild(input);
      (webFileInputRef as any).current = input;
      return () => {
        document.body.removeChild(input);
      };
    }
  }, []);

  const handleRefVideoStatusUpdate = (status: AVPlaybackStatus) => {
    if (status.isLoaded) {
      setIsRefVideoLoading(false);
      if (syncMode) {
        setSyncPosition(status.positionMillis);
        setIsRefVideoPlaying(status.isPlaying);
      } else {
        setRefVideoPosition(status.positionMillis);
        setIsRefVideoPlaying(status.isPlaying);
      }
      if (status.durationMillis && status.durationMillis !== refVideoDuration) {
        setRefVideoDuration(status.durationMillis);
      }
    }
  };

  const handleUserVideoStatusUpdate = (status: AVPlaybackStatus) => {
    if (status.isLoaded) {
      setIsUserVideoLoading(false);
      if (syncMode) {
        setSyncPosition(status.positionMillis);
        setIsUserVideoPlaying(status.isPlaying);
      } else {
        setUserVideoPosition(status.positionMillis);
        setIsUserVideoPlaying(status.isPlaying);
      }
      if (status.durationMillis && status.durationMillis !== userVideoDuration) {
        setUserVideoDuration(status.durationMillis);
      }
    }
  };

  // Update sync duration when video durations change
  useEffect(() => {
    if (syncMode) {
      setSyncDuration(Math.min(refVideoDuration || Infinity, userVideoDuration || Infinity) || 0);
    }
  }, [syncMode, refVideoDuration, userVideoDuration]);

  // Sync mode toggle
  const toggleSyncMode = async () => {
    if (!syncMode) {
      // Entering sync mode - pause both, sync positions
      await refVideoRef.current?.pauseAsync();
      await userVideoRef.current?.pauseAsync();
      const pos = Math.min(refVideoPosition, userVideoPosition);
      await refVideoRef.current?.setPositionAsync(pos);
      await userVideoRef.current?.setPositionAsync(pos);
      setSyncPosition(pos);
      setSyncMode(true);
    } else {
      setSyncMode(false);
    }
  };

  // Sync playback toggle
  const toggleSyncPlayback = async () => {
    const bothPlaying = isRefVideoPlaying && isUserVideoPlaying;
    if (bothPlaying) {
      await refVideoRef.current?.pauseAsync();
      await userVideoRef.current?.pauseAsync();
    } else {
      await refVideoRef.current?.setPositionAsync(syncPosition);
      await userVideoRef.current?.setPositionAsync(syncPosition);
      await refVideoRef.current?.playAsync();
      await userVideoRef.current?.playAsync();
    }
  };

  // Sync seek
  const handleSyncSeek = async (value: number) => {
    setIsSeeking(false);
    await refVideoRef.current?.setPositionAsync(value);
    await userVideoRef.current?.setPositionAsync(value);
    setSyncPosition(value);
  };

  // Individual video controls
  const toggleRefVideo = async () => {
    if (isRefVideoPlaying) {
      await refVideoRef.current?.pauseAsync();
    } else {
      await refVideoRef.current?.playAsync();
    }
  };

  const toggleUserVideo = async () => {
    if (isUserVideoPlaying) {
      await userVideoRef.current?.pauseAsync();
    } else {
      await userVideoRef.current?.playAsync();
    }
  };

  const handleRefVideoSeek = async (value: number) => {
    setIsSeekingRef(false);
    await refVideoRef.current?.setPositionAsync(value);
    setRefVideoPosition(value);
  };

  const handleUserVideoSeek = async (value: number) => {
    setIsSeekingUser(false);
    await userVideoRef.current?.setPositionAsync(value);
    setUserVideoPosition(value);
  };

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const pickVideoFromGallery = async () => {
    if (Platform.OS === 'web') {
      webFileInputRef.current?.click();
      return;
    }
    
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please grant media library access.');
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
    if (Platform.OS === 'web') {
      webFileInputRef.current?.click();
      return;
    }
    
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please grant camera permissions.');
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

  const handleChangeVideo = () => {
    if (Platform.OS === 'web') {
      webFileInputRef.current?.click();
    } else {
      Alert.alert(
        'Change Video',
        'Choose how you want to add your video',
        [
          { text: 'Record Video', onPress: recordVideo },
          { text: 'Choose from Gallery', onPress: pickVideoFromGallery },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
    }
  };

  const analyzeWorkout = async () => {
    if (!userVideo) return;
    if (Platform.OS === 'web' && !userVideoFile) {
      setAnalyzeError('Please re-select your video using the Change Video button.');
      return;
    }
    
    setIsUploading(true);
    setAnalyzeError(null);
    setAnalyzeStep('Preparing video...');
    
    try {
      const formData = new FormData();
      
      if (Platform.OS === 'web') {
        formData.append('file', userVideoFile!, userVideoFile!.name || 'workout.mp4');
      } else {
        const filename = userVideo.split('/').pop() ?? 'workout.mp4';
        formData.append('file', {
          uri: userVideo,
          name: filename,
          type: 'video/mp4',
        } as any);
      }

      setAnalyzeStep('Uploading your video...');
      const uploadRes = await api.post('/api/v1/files', formData);

      // Fetch + upload reference video in parallel with starting user analysis
      let refFileId: string | null = null;
      if (exercise.has_video) {
        try {
          setAnalyzeStep('Preparing reference video...');
          // Backend pulls from S3 directly — no CORS, no blob transfer
          const refUploadRes = await api.post(`/api/v1/files/from-exercise/${exercise.id}`);
          refFileId = refUploadRes.data.id;
          console.log('[VideoReview] ref registered ok, file_id=', refFileId);
        } catch (refErr) {
          console.warn('[VideoReview] reference video registration failed, continuing user only', refErr);
        }
      }

      setAnalyzeStep('Running pose analysis on both videos...');
      const [userAnalysisRes, refAnalysisRes] = await Promise.all([
        api.post('/api/v1/analysis/pose3d', { file_id: uploadRes.data.id }),
        refFileId
          ? api.post('/api/v1/analysis/pose3d', { file_id: refFileId })
          : Promise.resolve(null),
      ]);

      const combinedResult = {
        ...userAnalysisRes.data,
        ...(refAnalysisRes ? {
          reference_analysis_id:        refAnalysisRes.data.analysis_id,
          reference_download_url:       refAnalysisRes.data.download_url,
          reference_video_available:    refAnalysisRes.data.video_available,
          reference_video_download_url: refAnalysisRes.data.video_download_url,
        } : {}),
      };

      setAnalyzeStep(null);
      navigation.navigate('Result', { result: combinedResult });
    } catch (e: any) {
      const status = e.response?.status;
      const detail = e.response?.data?.detail ?? e.response?.data?.message;
      const msg = status
        ? `HTTP ${status}: ${detail ?? JSON.stringify(e.response?.data ?? '')}`
        : (e.message ?? 'Something went wrong');
      setAnalyzeError(`[${analyzeStep ?? 'init'}] ${msg}`);
      setAnalyzeStep(null);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.bg} />
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Review Your Video</Text>
        <View style={styles.placeholder} />
      </View>

      <View style={styles.exerciseInfo}>
        <Text style={styles.exerciseName}>{exercise.exercise_name}</Text>
        <Text style={styles.exerciseMuscle}>{exercise.muscle_name}</Text>
      </View>

      <ScrollView 
        style={styles.scrollContent} 
        showsVerticalScrollIndicator={false}
        scrollEnabled={!refZP.gestureActive && !userZP.gestureActive}
      >
        <View style={styles.videoComparisonContainer}>
          {/* Reference Video Panel */}
          <View style={styles.videoPanel}>
            <Text style={styles.videoLabel}>Reference</Text>
            <View 
              ref={refZP.containerRef} 
              style={styles.videoWrapper}
              {...refZP.panHandlers}
            >
              {isRefVideoLoading && referenceVideoUrl && (
                <View style={styles.loadingOverlay}>
                  <ActivityIndicator size="small" color={colors.accent} />
                </View>
              )}
              {referenceVideoUrl ? (
                <View ref={refZP.wrapperRef} style={styles.videoInnerWrapper}>
                  <Video
                    ref={refVideoRef}
                    source={{ uri: referenceVideoUrl }}
                    style={styles.video}
                    resizeMode={ResizeMode.CONTAIN}
                    shouldPlay={false}
                    isLooping={!syncMode}
                    onPlaybackStatusUpdate={handleRefVideoStatusUpdate}
                  />
                </View>
              ) : (
                <View style={styles.noVideoPlaceholder}>
                  <Text style={styles.noVideoText}>No reference</Text>
                </View>
              )}
              {/* Zoom Overlay */}
              {/* @ts-ignore */}
              <View style={styles.zoomOverlay} data-zoom-overlay="1">
                <TouchableOpacity
                  style={[styles.zoomBtn, refZP.displayScale <= ZOOM_MIN && styles.zoomBtnDisabled]}
                  onPress={refZP.zoomOut}
                  disabled={refZP.displayScale <= ZOOM_MIN}
                >
                  <Text style={styles.zoomBtnText}>−</Text>
                </TouchableOpacity>
                <Text style={styles.zoomLabelOverlay}>{Math.round(refZP.displayScale * 100)}%</Text>
                <TouchableOpacity
                  style={[styles.zoomBtn, refZP.displayScale >= ZOOM_MAX && styles.zoomBtnDisabled]}
                  onPress={refZP.zoomIn}
                  disabled={refZP.displayScale >= ZOOM_MAX}
                >
                  <Text style={styles.zoomBtnText}>+</Text>
                </TouchableOpacity>
              </View>
              <RotateOverlay
                zp={refZP}
                editValue={refAngleEdit}
                {...makeAngleHandlers(refZP, setRefAngleEdit)}
              />
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
            {!syncMode && (
              <TouchableOpacity style={styles.individualPlayButton} onPress={toggleRefVideo}>
                <Text style={styles.individualPlayIcon}>{isRefVideoPlaying ? '⏸' : '▶'}</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* User Video Panel */}
          <View style={styles.videoPanel}>
            <Text style={styles.videoLabel}>Your Video</Text>
            <View 
              ref={userZP.containerRef} 
              style={styles.videoWrapper}
              {...userZP.panHandlers}
            >
              {isUserVideoLoading && (
                <View style={styles.loadingOverlay}>
                  <ActivityIndicator size="small" color={colors.accent} />
                </View>
              )}
              <View ref={userZP.wrapperRef} style={styles.videoInnerWrapper}>
                <Video
                  ref={userVideoRef}
                  source={{ uri: userVideo }}
                  style={styles.video}
                  resizeMode={ResizeMode.CONTAIN}
                  shouldPlay={false}
                  isLooping={!syncMode}
                  onPlaybackStatusUpdate={handleUserVideoStatusUpdate}
                />
              </View>
              {/* Zoom Overlay */}
              {/* @ts-ignore */}
              <View style={styles.zoomOverlay} data-zoom-overlay="1">
                <TouchableOpacity
                  style={[styles.zoomBtn, userZP.displayScale <= ZOOM_MIN && styles.zoomBtnDisabled]}
                  onPress={userZP.zoomOut}
                  disabled={userZP.displayScale <= ZOOM_MIN}
                >
                  <Text style={styles.zoomBtnText}>−</Text>
                </TouchableOpacity>
                <Text style={styles.zoomLabelOverlay}>{Math.round(userZP.displayScale * 100)}%</Text>
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
              onSlidingComplete={handleSyncSeek}
              onValueChange={(value) => { if (isSeeking) setSyncPosition(value); }}
              minimumTrackTintColor={colors.accent}
              maximumTrackTintColor={colors.surface2}
              thumbTintColor={colors.accent}
            />
            <Text style={styles.seekbarTime}>{formatTime(syncDuration)}</Text>
          </View>
        )}

        {/* Sync Controls */}
        {syncMode && (
          <View style={styles.syncControls}>
            <TouchableOpacity style={styles.syncPlayButton} onPress={toggleSyncPlayback}>
              <Text style={styles.syncPlayIcon}>
                {(isRefVideoPlaying && isUserVideoPlaying) ? '⏸' : '▶'}
              </Text>
              <Text style={styles.syncPlayText}>
                {(isRefVideoPlaying && isUserVideoPlaying) ? 'Pause Both' : 'Play Both'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Action Buttons */}
        <View style={styles.actions}>
          <TouchableOpacity style={styles.changeVideoButton} onPress={handleChangeVideo}>
            <Text style={styles.changeVideoIcon}>🔄</Text>
            <Text style={styles.changeVideoText}>Change Video</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.analyzeButton, isUploading && styles.analyzeButtonDisabled]}
            onPress={analyzeWorkout}
            disabled={isUploading}
          >
            {isUploading ? (
              <>
                <ActivityIndicator size="small" color="#fff" />
                <Text style={styles.analyzeButtonText}>{analyzeStep || 'Processing...'}</Text>
              </>
            ) : (
              <>
                <Text style={styles.analyzeButtonIcon}>🎯</Text>
                <Text style={styles.analyzeButtonText}>Analyze My Form</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {analyzeError && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{analyzeError}</Text>
            <TouchableOpacity onPress={() => setAnalyzeError(null)}>
              <Text style={styles.dismissError}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity style={styles.cancelButton} onPress={() => navigation.goBack()}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  backIcon: { fontSize: 20, color: colors.text },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  placeholder: { width: 40 },
  exerciseInfo: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, alignItems: 'center' },
  exerciseName: { fontSize: 18, fontWeight: '800', color: colors.text, textAlign: 'center' },
  exerciseMuscle: { fontSize: 13, color: colors.muted, marginTop: spacing.xs },
  scrollContent: { flex: 1 },
  videoComparisonContainer: { flexDirection: 'row', paddingHorizontal: spacing.lg, gap: GAP, marginTop: spacing.md },
  videoPanel: { flex: 1, alignItems: 'center' },
  videoLabel: { fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: spacing.xs, textTransform: 'uppercase', letterSpacing: 0.5 },
  videoWrapper: {
    width: VIDEO_CONTAINER_WIDTH,
    aspectRatio: 9 / 16,
    backgroundColor: '#000',
    borderRadius: borderRadius.md,
    overflow: 'hidden',
    position: 'relative',
  },
  videoInnerWrapper: {
    width: '100%',
    height: '100%',
  },
  video: { width: '100%', height: '100%' },
  noVideoPlaceholder: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.surface },
  noVideoText: { fontSize: 12, color: colors.muted },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', zIndex: 10 },
  // Zoom overlay on each video
  zoomOverlay: {
    position: 'absolute',
    top: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 16,
    paddingHorizontal: 6,
    paddingVertical: 3,
    gap: 4,
  },
  zoomBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  zoomBtnDisabled: { opacity: 0.4 },
  zoomBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  zoomLabelOverlay: { color: '#fff', fontSize: 10, fontWeight: '600', minWidth: 28, textAlign: 'center' },
  // Individual video controls
  individualSeekbarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: spacing.xs,
    marginTop: spacing.xs,
  },
  individualSlider: { flex: 1, height: 30 },
  individualSeekbarTime: { fontSize: 9, color: colors.muted, minWidth: 28, textAlign: 'center' },
  individualPlayButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  individualPlayIcon: { fontSize: 12, color: '#fff' },
  // Sync mode
  syncModeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  syncModeButtonActive: {
    backgroundColor: colors.accent + '20',
    borderColor: colors.accent,
  },
  syncModeIcon: { fontSize: 16 },
  syncModeText: { fontSize: 13, fontWeight: '600', color: colors.text },
  syncModeTextActive: { color: colors.accent },
  syncModeIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.muted,
  },
  syncModeIndicatorActive: { backgroundColor: colors.accent },
  syncSeekbarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
  },
  seekbarTime: { fontSize: 11, color: colors.muted, minWidth: 36, textAlign: 'center' },
  slider: { flex: 1, height: 40 },
  syncControls: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  syncPlayButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.accent,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.md,
    gap: spacing.sm,
  },
  syncPlayIcon: { fontSize: 14, color: '#fff' },
  syncPlayText: { fontSize: 13, fontWeight: '600', color: '#fff' },
  // Actions
  actions: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.md },
  changeVideoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  changeVideoIcon: { fontSize: 18 },
  changeVideoText: { fontSize: 15, fontWeight: '600', color: colors.text },
  analyzeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    paddingVertical: spacing.lg,
    borderRadius: borderRadius.lg,
    gap: spacing.sm,
  },
  analyzeButtonDisabled: { opacity: 0.7 },
  analyzeButtonIcon: { fontSize: 20 },
  analyzeButtonText: { fontSize: 17, fontWeight: '700', color: '#fff' },
  errorContainer: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    backgroundColor: '#fee',
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: '#fcc',
  },
  errorText: { fontSize: 13, color: '#c00', marginBottom: spacing.sm },
  dismissError: { fontSize: 13, fontWeight: '600', color: colors.accent, textAlign: 'right' },
  cancelButton: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    paddingBottom: spacing.xl,
    alignItems: 'center',
  },
  cancelText: { fontSize: 15, fontWeight: '600', color: colors.muted },
});