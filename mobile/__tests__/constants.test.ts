/**
 * @format
 */
import {
  FIRMWARE_AP_SSID,
  FIRMWARE_AP_PASS,
  FIRMWARE_HOST,
  FIRMWARE_BASE_URL,
} from '../src/constants';

test('firmware connection constants are wired correctly', () => {
  expect(FIRMWARE_AP_SSID).toBe('FJ-OCS-Config');
  expect(FIRMWARE_AP_PASS.length).toBeGreaterThanOrEqual(8);
  expect(FIRMWARE_HOST).toBe('192.168.4.1');
  expect(FIRMWARE_BASE_URL).toBe(`http://${FIRMWARE_HOST}`);
});
