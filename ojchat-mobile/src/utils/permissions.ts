import notifee, { AuthorizationStatus } from '@notifee/react-native';
import { PermissionsAndroid, Platform } from 'react-native';

/**
 * Permission helpers for a bare React Native app (no Expo modules).
 */

export async function requestNotificationPermission(): Promise<boolean> {
  try {
    const settings = await notifee.requestPermission();
    return (
      settings.authorizationStatus === AuthorizationStatus.AUTHORIZED ||
      settings.authorizationStatus === AuthorizationStatus.PROVISIONAL
    );
  } catch {
    return false;
  }
}

export async function requestCameraPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true; // iOS prompts via Info.plist usage description
  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

export async function requestMediaLibraryPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true; // iOS prompts on first picker access
  // Android 13+ (API 33) uses the system photo picker and needs no permission.
  const sdkVersion = Platform.Version as number;
  if (sdkVersion >= 33) return true;
  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
  );
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

export async function requestLocationPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}
