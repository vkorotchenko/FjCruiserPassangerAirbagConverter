/**
 * @format
 */
import {
  FIRMWARE_AP_SSID,
  FIRMWARE_AP_PASS,
  FIRMWARE_AP_HOST,
  FIRMWARE_AP_URL,
  FIRMWARE_MDNS_URL,
} from '../src/constants';

test('firmware connection constants are wired correctly', () => {
  expect(FIRMWARE_AP_SSID).toBe('FJ-OCS-Config');
  expect(FIRMWARE_AP_PASS.length).toBeGreaterThanOrEqual(8);
  expect(FIRMWARE_AP_HOST).toBe('192.168.4.1');
  expect(FIRMWARE_AP_URL).toBe(`http://${FIRMWARE_AP_HOST}`);
  expect(FIRMWARE_MDNS_URL).toBe('http://fj-ocs.local');
});
