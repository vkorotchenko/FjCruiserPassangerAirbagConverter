/**
 * appVersion.ts — read the running app's versionName / versionCode from native
 * and cache it so components can read synchronously without a "—" flash.
 */
import DeviceInfo from 'react-native-device-info';

let cachedVersion: string | null = null;
let cachedBuildNumber: string | null = null;
let initialized = false;

/** Read versionName/versionCode from native and cache. Safe to call repeatedly. */
export async function initAppVersion(): Promise<void> {
  if (initialized) {
    return;
  }
  try {
    const [version, build] = await Promise.all([
      Promise.resolve(DeviceInfo.getVersion()),
      Promise.resolve(DeviceInfo.getBuildNumber()),
    ]);
    if (typeof version === 'string' && version.length > 0) {
      cachedVersion = version;
    }
    if (typeof build === 'string' && build.length > 0) {
      cachedBuildNumber = build;
    }
    initialized = true;
  } catch (e) {
    console.warn('[appVersion] init failed:', e);
  }
}

/** Synchronous read of cached versionName (e.g. "0.3.3"). null until init. */
export function getCachedAppVersion(): string | null {
  return cachedVersion;
}

/** Synchronous read of cached versionCode (e.g. "30300"). null until init. */
export function getCachedAppBuildNumber(): string | null {
  return cachedBuildNumber;
}
