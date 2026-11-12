import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/** Native services implemented in ios/App/App/DaybookNativePlugin.swift (iOS app only). */
export interface DaybookNativePlugin {
  shareFile(o: { name: string; text: string; mime: string }): Promise<{ completed: boolean; activityType: string }>;
  pickFile(o: { kind: 'json' | 'csv' }): Promise<{ cancelled?: boolean; name?: string; text?: string; size?: number }>;
  writeSnapshot(o: { text: string }): Promise<{ bytes: number }>;
  readSnapshot(): Promise<{ text: string | null; modifiedAt: number | null; previousText: string | null; previousModifiedAt: number | null }>;
  biometry(): Promise<{ available: boolean; biometry: 'faceID' | 'touchID' | 'opticID' | 'none' }>;
  authenticate(o: { reason: string; cancelTitle?: string }): Promise<{ success: boolean; error?: string }>;
  setPrivacyCover(o: { enabled: boolean }): Promise<void>;
  /** Tells the app the lock screen is on screen, so the native privacy cover can be removed. */
  lockShown(): Promise<void>;
  /** Fired by iOS when the app goes to the background with App Lock on. */
  addListener(eventName: 'lockRequired', listener: () => void): Promise<PluginListenerHandle>;
}

/** True inside the iOS app (Capacitor), false in Safari / the PWA / desktop browsers. */
export function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export const DaybookNative = registerPlugin<DaybookNativePlugin>('DaybookNative');
