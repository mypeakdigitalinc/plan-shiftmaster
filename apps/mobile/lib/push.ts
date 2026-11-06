/**
 * Push notifications via Expo. Native devices only; the web build skips it.
 * Needs an EAS project id (app.json → expo.extra.eas.projectId) to get tokens.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from './api';

const TOKEN_KEY = 'shifthub.push-token';
export const pushSupported = Platform.OS !== 'web';

if (pushSupported) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/** Ask permission, get this device's Expo token and register it with the API. Returns why it didn't, if it didn't. */
export async function registerForPush(): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!pushSupported) return { ok: false, reason: 'Push is not available on the web' };
  if (!Device.isDevice) return { ok: false, reason: 'Push needs a physical device' };
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  if (!projectId) return { ok: false, reason: 'Push is not configured yet (missing EAS project id)' };

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Shift updates',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return { ok: false, reason: 'Notifications are turned off in your phone settings' };

  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  await api.notifications.registerPushToken({ token, platform: Platform.OS === 'ios' ? 'ios' : 'android' });
  await AsyncStorage.setItem(TOKEN_KEY, token);
  return { ok: true };
}

/** Call before signing out so the next person on this phone doesn't get your notifications. */
export async function unregisterPush() {
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  if (!token) return;
  await api.notifications.unregisterPushToken(token).catch(() => {});
  await AsyncStorage.removeItem(TOKEN_KEY);
}

/** Subscribe to taps on notifications; returns an unsubscribe function. */
export function onNotificationTap(cb: (data: Record<string, unknown>) => void) {
  if (!pushSupported) return () => {};
  const sub = Notifications.addNotificationResponseReceivedListener((r) =>
    cb((r.notification.request.content.data ?? {}) as Record<string, unknown>),
  );
  return () => sub.remove();
}
