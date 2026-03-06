import { Platform } from 'react-native';

/**
 * Attempts to get a thumbnail image URI from a video URI.
 * On web, we return the video URI itself (browsers can display first frame).
 * On native, returns null (no expo-video-thumbnails installed).
 */
export async function get9x16Thumbnail(videoUri: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    // On web, return the video URI — the <video> element handles preview frames
    return videoUri;
  }

  // On native, return null — no thumbnail library installed
  // Install expo-video-thumbnails if thumbnail previews are needed
  return null;
}
