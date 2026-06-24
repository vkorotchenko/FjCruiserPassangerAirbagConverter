/**
 * Connection constants for the FJ OCS converter firmware.
 *
 * These mirror the firmware's WiFi config in `src/config.h`
 * (WIFI_AP_SSID / WIFI_AP_PASS) and the fixed SoftAP address the
 * ESP32 serves its web UI on. If you change them in the firmware,
 * change them here too.
 */
export const FIRMWARE_AP_SSID = 'FJ-OCS-Config';
export const FIRMWARE_AP_PASS = 'fjcruiser';

export const FIRMWARE_HOST = '192.168.4.1';
export const FIRMWARE_BASE_URL = `http://${FIRMWARE_HOST}`;
