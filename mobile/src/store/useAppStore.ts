import {create} from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SSID_KEY = 'fjocs.homeSsid';
const PASS_KEY = 'fjocs.homePassword';
const HOTSPOT_SSID_KEY = 'fjocs.hotspotSsid';
const HOTSPOT_PASS_KEY = 'fjocs.hotspotPassword';

/** Phases of the firmware OTA flow. */
export type FirmwareUpdateState =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'verifying'
  | 'flashing'
  | 'rebooting'
  | 'done'
  | 'error';

/** Minimal firmware-release info pushed into the store by the controller. */
export interface LatestFirmwareReleaseInput {
  tag: string;
  version: string;
  htmlUrl: string;
  binAssetUrl: string;
  binAssetSize: number;
  sha256AssetUrl: string;
  etag: string | null;
}

interface AppState {
  // --- Home WiFi / hotspot credentials --------------------------------------
  homeSsid: string;
  homePassword: string;
  hotspotSsid: string;
  hotspotPassword: string;
  lastStaIp: string | null;
  setHomeSsid: (ssid: string) => void;
  setHomePassword: (pass: string) => void;
  setHotspotSsid: (ssid: string) => void;
  setHotspotPassword: (pass: string) => void;
  setLastStaIp: (ip: string | null) => void;
  clearStoredWifi: () => Promise<void>;
  hydrate: () => Promise<void>;

  // --- App identity (informational only) -------------------------------------
  appVersion: string | null;
  appBuildNumber: string | null;
  setAppVersion: (version: string, build: string) => void;

  // --- Firmware OTA ----------------------------------------------------------
  /** Current firmware version reported by the converter (GET /api/info). */
  firmwareVersion: string | null;
  setFirmwareVersion: (v: string | null) => void;

  latestFwTag: string | null;
  latestFwVersion: string | null;
  latestFwUrl: string | null;
  latestFwBinUrl: string | null;
  latestFwSha256Url: string | null;
  latestFwSize: number | null;
  latestFwCheckedAt: number | null;
  latestFwEtag: string | null;

  firmwareUpdateState: FirmwareUpdateState;
  firmwareUpdateError: string | null;
  firmwareUpdateProgress: number; // 0..1
  firmwareUpdateBytesDone: number | null;
  firmwareUpdateBytesTotal: number | null;

  setLatestFirmwareRelease: (
    info: LatestFirmwareReleaseInput | null,
    checkedAt: number,
  ) => void;
  touchLatestFwCheckedAt: (checkedAt: number) => void;
  setFirmwareUpdateState: (s: FirmwareUpdateState) => void;
  setFirmwareUpdateError: (e: string | null) => void;
  setFirmwareUpdateProgress: (
    frac: number,
    done?: number | null,
    total?: number | null,
  ) => void;
  resetFirmwareUpdateProgress: () => void;
}

export const useAppStore = create<AppState>(set => ({
  homeSsid: '',
  homePassword: '',
  hotspotSsid: '',
  hotspotPassword: '',
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
  setHotspotSsid: ssid => {
    set({hotspotSsid: ssid});
    AsyncStorage.setItem(HOTSPOT_SSID_KEY, ssid).catch(() => {});
  },
  setHotspotPassword: pass => {
    set({hotspotPassword: pass});
    AsyncStorage.setItem(HOTSPOT_PASS_KEY, pass).catch(() => {});
  },
  setLastStaIp: ip => set({lastStaIp: ip}),
  clearStoredWifi: async () => {
    set({homeSsid: '', homePassword: '', hotspotSsid: '', hotspotPassword: ''});
    try {
      await AsyncStorage.multiRemove([
        SSID_KEY,
        PASS_KEY,
        HOTSPOT_SSID_KEY,
        HOTSPOT_PASS_KEY,
      ]);
    } catch {
      // ignore — non-fatal
    }
  },
  hydrate: async () => {
    try {
      const [ssid, pass, hsSsid, hsPass] = await Promise.all([
        AsyncStorage.getItem(SSID_KEY),
        AsyncStorage.getItem(PASS_KEY),
        AsyncStorage.getItem(HOTSPOT_SSID_KEY),
        AsyncStorage.getItem(HOTSPOT_PASS_KEY),
      ]);
      set({
        homeSsid: ssid ?? '',
        homePassword: pass ?? '',
        hotspotSsid: hsSsid ?? '',
        hotspotPassword: hsPass ?? '',
      });
    } catch {
      // ignore — non-fatal
    }
  },

  appVersion: null,
  appBuildNumber: null,
  setAppVersion: (version, build) =>
    set({appVersion: version, appBuildNumber: build}),

  firmwareVersion: null,
  setFirmwareVersion: v => set({firmwareVersion: v}),

  latestFwTag: null,
  latestFwVersion: null,
  latestFwUrl: null,
  latestFwBinUrl: null,
  latestFwSha256Url: null,
  latestFwSize: null,
  latestFwCheckedAt: null,
  latestFwEtag: null,

  firmwareUpdateState: 'idle',
  firmwareUpdateError: null,
  firmwareUpdateProgress: 0,
  firmwareUpdateBytesDone: null,
  firmwareUpdateBytesTotal: null,

  setLatestFirmwareRelease: (info, checkedAt) =>
    set(
      info
        ? {
            latestFwTag: info.tag,
            latestFwVersion: info.version,
            latestFwUrl: info.htmlUrl,
            latestFwBinUrl: info.binAssetUrl,
            latestFwSha256Url: info.sha256AssetUrl,
            latestFwSize: info.binAssetSize,
            latestFwCheckedAt: checkedAt,
            latestFwEtag: info.etag,
          }
        : {
            latestFwTag: null,
            latestFwVersion: null,
            latestFwUrl: null,
            latestFwBinUrl: null,
            latestFwSha256Url: null,
            latestFwSize: null,
            latestFwCheckedAt: checkedAt,
            latestFwEtag: null,
          },
    ),
  touchLatestFwCheckedAt: checkedAt => set({latestFwCheckedAt: checkedAt}),
  setFirmwareUpdateState: s => set({firmwareUpdateState: s}),
  setFirmwareUpdateError: e => set({firmwareUpdateError: e}),
  setFirmwareUpdateProgress: (frac, done = null, total = null) =>
    set({
      firmwareUpdateProgress: Math.max(0, Math.min(1, frac)),
      firmwareUpdateBytesDone: done,
      firmwareUpdateBytesTotal: total,
    }),
  resetFirmwareUpdateProgress: () =>
    set({
      firmwareUpdateProgress: 0,
      firmwareUpdateBytesDone: null,
      firmwareUpdateBytesTotal: null,
    }),
}));
