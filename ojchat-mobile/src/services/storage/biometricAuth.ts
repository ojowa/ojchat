import * as Keychain from 'react-native-keychain';

import { STORAGE_KEYS } from '../../constants/storageKeys';

/**
 * Biometric authentication backed by react-native-keychain
 * (replaces expo-local-authentication).
 *
 * Keychain has no standalone "prompt" API, so `authenticate()` probes a
 * dedicated throwaway secret that is protected by biometry: reading it back
 * triggers the native fingerprint/face prompt.
 */

const PROBE_SERVICE = `${STORAGE_KEYS.BIOMETRIC_AUTH}.probe`;

export class BiometricAuthService {
  static async isAvailable(): Promise<boolean> {
    try {
      const type = await Keychain.getSupportedBiometryType();
      return type !== null;
    } catch {
      return false;
    }
  }

  static async getBiometricType(): Promise<'fingerprint' | 'face' | 'iris' | null> {
    try {
      const type = await Keychain.getSupportedBiometryType();
      if (!type) return null;
      if (type === 'Fingerprint') return 'fingerprint';
      if (type === 'FaceID' || type === 'Face') return 'face';
      if (type === 'Iris') return 'iris';
      return null;
    } catch {
      return null;
    }
  }

  static async authenticate(
    reason: string,
  ): Promise<{ success: boolean; error?: string; biometricType: string | null }> {
    const biometricType = await this.getBiometricType();
    if (!biometricType) {
      return { success: false, error: 'Biometric not available', biometricType: null };
    }
    try {
      const existing = await Keychain.getGenericPassword({ service: PROBE_SERVICE });
      if (!existing) {
        await Keychain.setGenericPassword('probe', 'probe', {
          service: PROBE_SERVICE,
          accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
          accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET_OR_DEVICE_PASSCODE,
        });
      }
      const result = await Keychain.getGenericPassword({
        service: PROBE_SERVICE,
        authenticationPrompt: {
          title: reason,
          subtitle: 'Verify your identity',
          cancel: 'Cancel',
        },
      });
      if (!result) {
        return { success: false, error: 'Biometric prompt failed', biometricType };
      }
      return { success: true, biometricType };
    } catch (error: any) {
      return { success: false, error: error?.message, biometricType };
    }
  }

  static async storeCredentials(username: string, password: string): Promise<boolean> {
    try {
      await Keychain.setGenericPassword(username, password, {
        service: STORAGE_KEYS.BIOMETRIC_AUTH,
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        securityLevel: Keychain.SECURITY_LEVEL.SECURE_HARDWARE,
      });
      return true;
    } catch {
      return false;
    }
  }

  static async retrieveCredentials(): Promise<{ username: string; password: string } | null> {
    try {
      const credentials = await Keychain.getGenericPassword({
        service: STORAGE_KEYS.BIOMETRIC_AUTH,
        authenticationPrompt: {
          title: 'Authenticate to sign in',
          subtitle: 'Verify your identity',
          cancel: 'Cancel',
        },
      });
      return credentials ? credentials : null;
    } catch {
      return null;
    }
  }

  static async deleteCredentials(): Promise<boolean> {
    try {
      const probeDeleted = await Keychain.resetGenericPassword({ service: PROBE_SERVICE });
      const deleted = await Keychain.resetGenericPassword({
        service: STORAGE_KEYS.BIOMETRIC_AUTH,
      });
      return deleted || probeDeleted;
    } catch {
      return false;
    }
  }
}
