import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import ImageResizer from 'react-native-image-resizer';
import { PermissionsAndroid, Platform } from 'react-native';
import { apiClient } from '../services/api/apiClient';
import { ENDPOINTS } from '../constants/endpoints';
import { ProcessedImage } from '../types/media';

const MAX_DIMENSION = 1080;
const JPEG_QUALITY = 82; // matches the previous 0.82 compress factor
const PICKER_QUALITY = 0.9;

async function ensureCameraPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true; // iOS prompts via NSCameraUsageDescription
  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

/**
 * Image picking + processing with react-native-image-picker and
 * react-native-image-resizer (replaces expo-image-picker / expo-image-manipulator).
 *
 * Note: react-native-image-picker has no built-in crop UI (the old
 * `allowsEditing`/`aspect` options), so selection returns the full image and
 * processing only resizes/compresses.
 */
export class ImageProcessor {
  static async pickImage(): Promise<ProcessedImage | null> {
    const result = await launchImageLibrary({
      mediaType: 'photo',
      quality: PICKER_QUALITY,
    });
    if (result.didCancel || result.errorCode === 'permission') return null;
    const uri = result.assets?.[0]?.uri;
    if (!uri) return null;
    return this.processImage(uri);
  }

  static async takePhoto(): Promise<ProcessedImage | null> {
    if (!(await ensureCameraPermission())) return null;
    const result = await launchCamera({
      mediaType: 'photo',
      quality: PICKER_QUALITY,
      cameraType: 'back',
    });
    if (result.didCancel || result.errorCode === 'permission') return null;
    const uri = result.assets?.[0]?.uri;
    if (!uri) return null;
    return this.processImage(uri);
  }

  static async processImage(uri: string): Promise<ProcessedImage> {
    const resized = await ImageResizer.createResizedImage(
      uri,
      MAX_DIMENSION,
      // Large bound so the width limit governs, matching the old
      // `resize: { width: 1080 }` behaviour that preserved the aspect ratio.
      MAX_DIMENSION * 10,
      'JPEG',
      JPEG_QUALITY,
      0,
      undefined,
      false,
      { mode: 'contain', onlyScaleDown: true },
    );
    return {
      uri: resized.uri,
      width: resized.width,
      height: resized.height,
      size: resized.size ?? 0,
      mimeType: 'image/jpeg',
    };
  }

  static async uploadImage(
    processedImage: ProcessedImage,
    onProgress?: (p: number) => void,
  ): Promise<string> {
    const formData = new FormData();
    formData.append('photo', {
      uri: processedImage.uri,
      type: processedImage.mimeType,
      name: `photo_${Date.now()}.jpg`,
    } as unknown as Blob);
    const response = await apiClient.post(ENDPOINTS.MEDIA.UPLOAD, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => {
        if (onProgress && e.total) onProgress(Math.round((e.loaded * 100) / e.total));
      },
    });
    const data = response.data?.data || response.data;
    return data?.url || '';
  }
}
