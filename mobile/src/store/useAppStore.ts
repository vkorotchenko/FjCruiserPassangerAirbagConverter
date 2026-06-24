import {create} from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SSID_KEY = 'fjocs.homeSsid';

interface AppState {
  /** Last home-WiFi SSID the user entered (remembered across launches). */
  homeSsid: string;
  /** Last station IP the firmware reported after joining home WiFi. */
  lastStaIp: string | null;
  setHomeSsid: (ssid: string) => void;
  setLastStaIp: (ip: string | null) => void;
  /** Load persisted values from disk (call once at startup). */
  hydrate: () => Promise<void>;
}

export const useAppStore = create<AppState>(set => ({
  homeSsid: '',
  lastStaIp: null,
  setHomeSsid: ssid => {
    set({homeSsid: ssid});
    AsyncStorage.setItem(SSID_KEY, ssid).catch(() => {});
  },
  setLastStaIp: ip => set({lastStaIp: ip}),
  hydrate: async () => {
    try {
      const saved = await AsyncStorage.getItem(SSID_KEY);
      if (saved) {
        set({homeSsid: saved});
      }
    } catch {
      // ignore — non-fatal
    }
  },
}));
