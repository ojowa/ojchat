import { Platform, Vibration } from 'react-native';

// Haptic feedback via native Vibration API (replaces expo-haptics).
const isAndroid = Platform.OS === 'android';

function vibrate(pattern: number | number[]) {
  Vibration.vibrate(pattern);
}

export function impactLight() {
  vibrate(10);
}

export function impactMedium() {
  vibrate(25);
}

export function impactHeavy() {
  vibrate(40);
}

export function notificationSuccess() {
  vibrate([0, 20, 40, 20]);
}

export function notificationWarning() {
  vibrate([0, 30, 60, 30]);
}

export function notificationError() {
  vibrate([0, 50, 80, 50]);
}

// Kept for parity with the previous API surface.
export const supportsHaptics = isAndroid || Platform.OS === 'ios';
