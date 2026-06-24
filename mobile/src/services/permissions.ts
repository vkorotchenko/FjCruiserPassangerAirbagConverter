import {Platform, PermissionsAndroid, Permission} from 'react-native';

/**
 * Request the runtime permissions react-native-wifi-reborn needs to read the
 * current SSID and join the firmware's access point.
 *
 * - Android < 13: ACCESS_FINE_LOCATION is required for both reading the SSID
 *   and connecting to a network.
 * - Android 13+: NEARBY_WIFI_DEVICES lets us connect without location, but we
 *   still request location because reading the *current* SSID needs it.
 *
 * iOS handles these via Info.plist usage strings / entitlements, so this is a
 * no-op there.
 */
export async function requestWifiPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }

  const fine = PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
  const perms: Permission[] = [fine];

  // NEARBY_WIFI_DEVICES only exists on API 33+. Guard the lookup so older RN
  // typings / devices don't throw on an undefined constant.
  const nearby = (PermissionsAndroid.PERMISSIONS as Record<string, Permission>)
    .NEARBY_WIFI_DEVICES;
  if (Number(Platform.Version) >= 33 && nearby) {
    perms.push(nearby);
  }

  try {
    const result = await PermissionsAndroid.requestMultiple(perms);
    return result[fine] === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}
