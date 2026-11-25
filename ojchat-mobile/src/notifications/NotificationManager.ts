import notifee, {
  AndroidImportance,
  AuthorizationStatus,
  EventType,
  type Event,
} from '@notifee/react-native';
import { Platform } from 'react-native';
import { apiClient } from '../services/api/apiClient';
import { ENDPOINTS } from '../constants/endpoints';
import { useAppStore } from '../store';
import { secureStorage } from '../services/storage/secureStorage';
import { randomUUID } from '../services/crypto/aesCrypto';

type NotificationData = Record<string, string | object | number>;
type NotificationNavigationCallback = (screen: string, params?: Record<string, any>) => void;

const DEVICE_ID_KEY = 'notifications.deviceId';

let backgroundListenerRegistered = false;

/**
 * Local + remote notifications for the bare React Native app.
 *
 * Replaces expo-notifications / expo-device / expo-constants with
 * @notifee/react-native.
 *
 * NOTE: remote push still needs an FCM (Android) / APNs (iOS) provider wired
 * up on the native side plus a server-side sender. Until that exists,
 * `registerForPushNotificationsAsync` returns null and only local
 * notifications are delivered.
 */
export class NotificationManager {
  private static instance: NotificationManager;
  private pushToken: string | null = null;
  private unsubscribeForeground: (() => void) | null = null;
  private navigationCallback: NotificationNavigationCallback | null = null;
  private deviceId: string | null = null;

  static getInstance(): NotificationManager {
    if (!NotificationManager.instance) NotificationManager.instance = new NotificationManager();
    return NotificationManager.instance;
  }

  setNavigationCallback(callback: NotificationNavigationCallback): void {
    this.navigationCallback = callback;
  }

  async initialize(): Promise<void> {
    try {
      const settings = await notifee.requestPermission();
      const authorized =
        settings.authorizationStatus === AuthorizationStatus.AUTHORIZED ||
        settings.authorizationStatus === AuthorizationStatus.PROVISIONAL;
      if (!authorized) return;

      if (Platform.OS === 'android') await this.setupAndroidChannels();

      this.registerBackgroundListener();
      this.registerForegroundListener();

      // Cold start: the app was launched by tapping a notification.
      const initial = await notifee.getInitialNotification();
      if (initial?.notification?.data) {
        this.handleNotificationResponse(initial.notification.data);
      }

      this.pushToken = await this.registerForPushNotificationsAsync();
      if (this.pushToken) await this.registerTokenWithBackend(this.pushToken);
    } catch (error: any) {
      // Silent failure — push notifications are non-critical
    }
  }

  private registerForegroundListener(): void {
    this.unsubscribeForeground?.();
    this.unsubscribeForeground = notifee.onForegroundEvent((event: Event) => {
      const data = event.detail.notification?.data;
      if (!data) return;
      if (event.type === EventType.PRESS || event.type === EventType.ACTION_PRESS) {
        this.handleNotificationResponse(data);
      } else if (event.type === EventType.DELIVERED) {
        this.handleNotificationReceived(data);
      }
    });
  }

  private registerBackgroundListener(): void {
    if (backgroundListenerRegistered) return;
    backgroundListenerRegistered = true;
    notifee.onBackgroundEvent(async (event: Event) => {
      const data = event.detail.notification?.data;
      if (!data) return;
      if (event.type === EventType.PRESS || event.type === EventType.ACTION_PRESS) {
        this.handleNotificationResponse(data);
      } else if (event.type === EventType.DELIVERED) {
        this.handleNotificationReceived(data);
      }
    });
  }

  /**
   * TODO: wire up FCM (Android) / APNs (iOS).
   * A bare React Native app has no equivalent of `getExpoPushTokenAsync()` —
   * the token comes from @react-native-firebase/messaging (or a native FCM
   * integration), so this returns null until that is configured.
   */
  private async registerForPushNotificationsAsync(): Promise<string | null> {
    return null;
  }

  private async registerTokenWithBackend(token: string): Promise<void> {
    try {
      await apiClient.post(ENDPOINTS.NOTIFICATIONS.REGISTER, {
        token,
        platform: Platform.OS,
        deviceId: await this.getDeviceId(),
      });
    } catch {
      // Token registration failure is non-critical
    }
  }

  private async getDeviceId(): Promise<string> {
    if (this.deviceId) return this.deviceId;
    try {
      const existing = await secureStorage.get(DEVICE_ID_KEY);
      if (existing) {
        this.deviceId = existing;
        return existing;
      }
      const created = randomUUID();
      await secureStorage.set(DEVICE_ID_KEY, created);
      this.deviceId = created;
      return created;
    } catch {
      this.deviceId = randomUUID();
      return this.deviceId;
    }
  }

  private async setupAndroidChannels(): Promise<void> {
    await notifee.createChannels([
      {
        id: 'messages',
        name: 'Messages',
        importance: AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF6B6B',
      },
      {
        id: 'calls',
        name: 'Calls',
        importance: AndroidImportance.HIGH,
        vibrationPattern: [0, 1000],
      },
      {
        id: 'matches',
        name: 'Matches',
        importance: AndroidImportance.DEFAULT,
      },
    ]);
  }

  private handleNotificationReceived = (data: NotificationData): void => {
    if (data.type === 'message' && data.conversationId) {
      useAppStore.getState().incrementUnread(String(data.conversationId));
    }
  };

  private handleNotificationResponse = (data: NotificationData): void => {
    if (!this.navigationCallback || !data) return;

    switch (data.type) {
      case 'message':
        this.navigationCallback('Chat', { conversationId: data.conversationId });
        break;
      case 'match':
        this.navigationCallback('Matches');
        break;
      case 'call':
        this.navigationCallback('IncomingCall', {
          callerId: data.callerId,
          callerName: data.callerName,
          callType: data.callType || 'voice',
        });
        break;
      case 'like':
        this.navigationCallback('Likes');
        break;
      default:
        this.navigationCallback('Main');
        break;
    }
  };

  async setBadgeCount(count: number): Promise<void> {
    await notifee.setBadgeCount(count);
  }

  destroy(): void {
    this.unsubscribeForeground?.();
    this.unsubscribeForeground = null;
  }
}
