import {FIRMWARE_BASE_URL} from '../constants';

/** Shape of `GET /api/info` from the firmware (src/WebInterface.cpp). */
export interface FirmwareInfo {
  hostname: string;
  apIp: string;
  staIp: string;
  staOk: boolean;
  clients: number;
}

const DEFAULT_TIMEOUT_MS = 6000;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function request(
  path: string,
  init: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${FIRMWARE_BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch firmware status. Throws on network error / non-2xx. */
export async function getInfo(timeoutMs?: number): Promise<FirmwareInfo> {
  const res = await request('/api/info', {method: 'GET'}, timeoutMs);
  if (!res.ok) {
    throw new Error(`GET /api/info failed (${res.status})`);
  }
  return (await res.json()) as FirmwareInfo;
}

/** True if the firmware AP is reachable right now. Never throws. */
export async function pingFirmware(timeoutMs = 4000): Promise<boolean> {
  try {
    await getInfo(timeoutMs);
    return true;
  } catch {
    return false;
  }
}

/** Hand the user's home WiFi credentials to the firmware. Throws on failure. */
export async function postWifi(ssid: string, pass: string): Promise<void> {
  const res = await request('/api/wifi', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ssid, pass}),
  });
  if (!res.ok) {
    let message = `POST /api/wifi failed (${res.status})`;
    try {
      const body = (await res.json()) as {err?: string};
      if (body?.err) {
        message = body.err;
      }
    } catch {
      // keep the default message
    }
    throw new Error(message);
  }
}

export interface WaitForStationOptions {
  timeoutMs?: number;
  intervalMs?: number;
  /** Called after every poll with the latest info (or null if unreachable). */
  onTick?: (info: FirmwareInfo | null) => void;
}

/**
 * Poll `GET /api/info` until the firmware reports it has joined the home WiFi
 * (`staOk` + a real `staIp`). Resolves with that info, or rejects on timeout —
 * the most common cause of a timeout is a wrong home-WiFi password.
 */
export async function waitForStation({
  timeoutMs = 30000,
  intervalMs = 2000,
  onTick,
}: WaitForStationOptions = {}): Promise<FirmwareInfo> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    let info: FirmwareInfo | null = null;
    try {
      info = await getInfo(5000);
    } catch {
      info = null;
    }
    onTick?.(info);

    if (info && info.staOk && info.staIp && info.staIp !== '0.0.0.0') {
      return info;
    }
    await delay(intervalMs);
  }

  throw new Error(
    'The converter did not join your WiFi in time. Double-check the password and try again.',
  );
}
