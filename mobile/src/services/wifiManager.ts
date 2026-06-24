import {Platform} from 'react-native';
import WifiManager from 'react-native-wifi-reborn';

import {FIRMWARE_AP_SSID, FIRMWARE_AP_PASS} from '../constants';

/**
 * Best-effort read of the phone's currently-connected WiFi SSID so we can
 * pre-fill the home-network field. Returns null when it can't be determined
 * (permissions denied, location off, not on WiFi, or an iOS device without the
 * "Access WiFi Information" entitlement).
 */
export async function getCurrentSsid(): Promise<string | null> {
  try {
    const ssid = await WifiManager.getCurrentWifiSSID();
    if (!ssid) {
      return null;
    }
    // Android returns "<unknown ssid>" when permission/location is missing.
    if (ssid.toLowerCase().includes('unknown')) {
      return null;
    }
    return ssid;
  } catch {
    return null;
  }
}

/**
 * Best-effort snapshot of the phone's current WiFi network for diagnostics:
 * the SSID it's joined to and the IP address it holds on that network.
 */
export async function getNetworkInfo(): Promise<{
  ssid: string | null;
  ip: string | null;
}> {
  let ssid: string | null = null;
  let ip: string | null = null;
  try {
    ssid = await getCurrentSsid();
  } catch {
    // ignore
  }
  if (Platform.OS === 'android') {
    try {
      ip = await WifiManager.getIP();
    } catch {
      // ignore — getIP is Android-only / may fail when off WiFi
    }
  }
  return {ssid, ip};
}

/**
 * Join the firmware's SoftAP so we can reach it at 192.168.4.1. Throws if the
 * join fails (the UI then falls back to a guided manual join).
 */
export async function connectToFirmwareAp(): Promise<void> {
  await WifiManager.connectToProtectedWifiSSID({
    ssid: FIRMWARE_AP_SSID,
    password: FIRMWARE_AP_PASS,
    isWEP: false,
    isHidden: false,
    timeout: 20,
  });
}

/**
 * Force app traffic over the (internet-less) WiFi AP. Without this, some
 * Android vendors silently route HTTP back over mobile data and the firmware
 * at 192.168.4.1 becomes unreachable. No-op / best-effort off Android.
 */
export async function bindToWifi(): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }
  try {
    await WifiManager.forceWifiUsageWithOptions(true, {noInternet: true});
  } catch {
    // Non-fatal: most devices still route to 192.168.4.1 without this.
  }
}

/**
 * Stop forcing app traffic over WiFi. Call when leaving the converter flow so
 * the phone can use mobile data again.
 */
export async function releaseForcedWifi(): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }
  try {
    await WifiManager.forceWifiUsageWithOptions(false, {noInternet: true});
  } catch {
    // ignore
  }
}

/**
 * Whether the phone currently reports being joined to the firmware AP. Used by
 * the manual-join fallback to detect when the user has connected by hand.
 */
export async function isOnFirmwareAp(): Promise<boolean> {
  const ssid = await getCurrentSsid();
  return ssid === FIRMWARE_AP_SSID;
}
