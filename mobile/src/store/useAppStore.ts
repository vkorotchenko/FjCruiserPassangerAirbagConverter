import {create} from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SSID_KEY = 'fjocs.homeSsid';
const PASS_KEY = 'fjocs.homePassword';

/** Phases of the in-app self-update flow. */
export type AppUpdateState =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'verifying'
  | 'ready'
  | 'error';

/** Minimal release info pushed into the store by the update controller. */
export interface LatestAppReleaseInput {
  tag: string;
  version: string;
  htmlUrl: string;
  apkAssetUrl: string;
  apkAssetSize: number;
  sha256AssetUrl: string;
  etag: string | null;
}

interface AppState {
  /** Last home-WiFi SSID the user entered (remembered across launches). */
  homeSsid: string;
  /** Last home-WiFi password the user entered (remembered across launches). */
  homePassword: string;
  /** Last station IP the firmware reported after joining home WiFi. */
  lastStaIp: string | null;
  setHomeSsid: (ssid: string) => void;
  setHomePassword: (pass: string) => void;
  setLastStaIp: (ip: string | null) => void;
  /** Forget the saved home-WiFi SSID + password (preferences + state). */
  clearStoredWifi: () => Promise<void>;
  /** Load persisted values from disk (call once at startup). */
  hydrate: () => Promise<void>;

  // --- App self-update (OTA) -------------------------------------------------
  appVersion: string | null; // running versionName, e.g. "0.1.0"
  appBuildNumber: string | null; // running versionCode, e.g. "100"
  setAppVersion: (version: string, build: string) => void;

  latestAppReleaseTag: string | null;
  latestAppReleaseVersion: string | null;
  latestAppReleaseUrl: string | null;
  latestAppReleaseAssetUrl: string | null;
  latestAppReleaseSha256Url: string | null;
  latestAppReleaseSize: number | null;
  latestAppReleaseCheckedAt: number | null;
  latestAppReleaseEtag: string | null;

  appUpdateState: AppUpdateState;
  appUpdateError: string | null;
  appUpdateProgress: number; // 0..1
  appUpdateBytesReceived: number | null;
  appUpdateBytesTotal: number | null;

  setLatestAppRelease: (
    info: LatestAppReleaseInput | null,
    checkedAt: number,
  ) => void;
  touchLatestAppReleaseCheckedAt: (checkedAt: number) => void;
  setAppUpdateState: (s: AppUpdateState) => void;
  setAppUpdateError: (e: string | null) => void;
  setAppUpdateProgress: (
    frac: number,
    received?: number | null,
    total?: number | null,
  ) => void;
  resetAppUpdateProgress: () => void;
}

export const useAppStore = create<AppState>(set => ({
  homeSsid: '',
  homePassword: '',
  lastStaIp: null,
  setHomeSsid: ssid => {
    set({homeSsid: ssid});
    AsyncStorage.setItem(SSID_KEY, ssid).catch(() => {});
  },
  setHomePassword: pass => {
    set({homePassword: pass});
    // Stored in app-private preferences (AsyncStorage) so the user need not
    // retype it. Not encrypted at rest — acceptable for a single-purpose tool.
    AsyncStorage.setItem(PASS_KEY, pass).catch(() => {});
  },
  setLastStaIp: ip => set({lastStaIp: ip}),
  clearStoredWifi: async () => {
    set({homeSsid: '', homePassword: ''});
    try {
      await AsyncStorage.multiRemove([SSID_KEY, PASS_KEY]);
    } catch {
      // ignore — non-fatal
    }
  },
  hydrate: async () => {
    try {
      const [ssid, pass] = await Promise.all([
        AsyncStorage.getItem(SSID_KEY),
        AsyncStorage.getItem(PASS_KEY),
      ]);
      set({homeSsid: ssid ?? '', homePassword: pass ?? ''});
    } catch {
      // ignore — non-fatal
    }
  },

  // --- App self-update (OTA) -------------------------------------------------
  appVersion: null,
  appBuildNumber: null,
  setAppVersion: (version, build) =>
    set({appVersion: version, appBuildNumber: build}),

  latestAppReleaseTag: null,
  latestAppReleaseVersion: null,
  latestAppReleaseUrl: null,
  latestAppReleaseAssetUrl: null,
  latestAppReleaseSha256Url: null,
  latestAppReleaseSize: null,
  latestAppReleaseCheckedAt: null,
  latestAppReleaseEtag: null,

  appUpdateState: 'idle',
  appUpdateError: null,
  appUpdateProgress: 0,
  appUpdateBytesReceived: null,
  appUpdateBytesTotal: null,

  setLatestAppRelease: (info, checkedAt) =>
    set(
      info
        ? {
            latestAppReleaseTag: info.tag,
            latestAppReleaseVersion: info.version,
            latestAppReleaseUrl: info.htmlUrl,
            latestAppReleaseAssetUrl: info.apkAssetUrl,
            latestAppReleaseSha256Url: info.sha256AssetUrl,
            latestAppReleaseSize: info.apkAssetSize,
            latestAppReleaseCheckedAt: checkedAt,
            latestAppReleaseEtag: info.etag,
          }
        : {
            latestAppReleaseTag: null,
            latestAppReleaseVersion: null,
            latestAppReleaseUrl: null,
            latestAppReleaseAssetUrl: null,
            latestAppReleaseSha256Url: null,
            latestAppReleaseSize: null,
            latestAppReleaseCheckedAt: checkedAt,
            latestAppReleaseEtag: null,
          },
    ),
  touchLatestAppReleaseCheckedAt: checkedAt =>
    set({latestAppReleaseCheckedAt: checkedAt}),
  setAppUpdateState: s => set({appUpdateState: s}),
  setAppUpdateError: e => set({appUpdateError: e}),
  setAppUpdateProgress: (frac, received = null, total = null) =>
    set({
      appUpdateProgress: Math.max(0, Math.min(1, frac)),
      appUpdateBytesReceived: received,
      appUpdateBytesTotal: total,
    }),
  resetAppUpdateProgress: () =>
    set({
      appUpdateProgress: 0,
      appUpdateBytesReceived: null,
      appUpdateBytesTotal: null,
    }),
}));
