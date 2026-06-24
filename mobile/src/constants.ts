/**
 * Connection constants for the FJ OCS converter firmware.
 *
 * These mirror the firmware's WiFi config in `src/config.h`
 * (WIFI_AP_SSID / WIFI_AP_PASS / WIFI_HOSTNAME) and the fixed SoftAP address.
 * If you change them in the firmware, change them here too.
 */
export const FIRMWARE_AP_SSID = 'FJ-OCS-Config';
export const FIRMWARE_AP_PASS = 'fjcruiser';

export const FIRMWARE_HOSTNAME = 'fj-ocs';

// The converter's always-on SoftAP address (used for first-time setup and as a
// fallback). The firmware also advertises mDNS as `<hostname>.local` once it
// has joined the home network.
export const FIRMWARE_AP_HOST = '192.168.4.1';
export const FIRMWARE_AP_URL = `http://${FIRMWARE_AP_HOST}`;
export const FIRMWARE_MDNS_URL = `http://${FIRMWARE_HOSTNAME}.local`;
