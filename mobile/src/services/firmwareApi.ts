import {FIRMWARE_AP_URL, FIRMWARE_HOSTNAME} from '../constants';

/** Shape of `GET /api/info` from the firmware (src/WebInterface.cpp). */
export interface FirmwareInfo {
  hostname: string;
  fwVersion: string;
  apIp: string;
  staIp: string;
  staOk: boolean;
  clients: number;
}

const DEFAULT_TIMEOUT_MS = 6000;

// The base URL the app currently uses to reach the converter. Defaults to the
// SoftAP; updated to the home-network IP / mDNS name once we detect the
// firmware there (see probeFirstReachable / WifiSetupScreen).
let activeBaseUrl = FIRMWARE_AP_URL;

export function getActiveBaseUrl(): string {
  return activeBaseUrl;
}

export function setActiveBaseUrl(url: string): void {
  activeBaseUrl = url;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function request(
  baseUrl: string,
  path: string,
  init: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${baseUrl}${path}`, {...init, signal: controller.signal});
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch firmware status from a specific base URL. Throws on error / non-2xx. */
export async function getInfoAt(
  baseUrl: string,
  timeoutMs?: number,
): Promise<FirmwareInfo> {
  const res = await request(baseUrl, '/api/info', {method: 'GET'}, timeoutMs);
  if (!res.ok) {
    throw new Error(`GET /api/info failed (${res.status})`);
  }
  return (await res.json()) as FirmwareInfo;
}

/** Fetch firmware status from the active base URL. */
export function getInfo(timeoutMs?: number): Promise<FirmwareInfo> {
  return getInfoAt(activeBaseUrl, timeoutMs);
}

/** True if the active base URL is reachable right now. Never throws. */
export async function pingFirmware(timeoutMs = 4000): Promise<boolean> {
  try {
    await getInfo(timeoutMs);
    return true;
  } catch {
    return false;
  }
}

/**
 * Probe several candidate base URLs in parallel and resolve with the first one
 * that answers `GET /api/info`, or null if none do within `timeoutMs`. Does NOT
 * mutate the active base URL — the caller decides.
 */
export function probeFirstReachable(
  baseUrls: string[],
  timeoutMs = 3000,
): Promise<string | null> {
  return new Promise(resolve => {
    let remaining = baseUrls.length;
    if (remaining === 0) {
      resolve(null);
      return;
    }
    let settled = false;
    baseUrls.forEach(url => {
      getInfoAt(url, timeoutMs)
        .then(() => {
          if (!settled) {
            settled = true;
            resolve(url);
          }
        })
        .catch(() => {
          remaining -= 1;
          if (remaining === 0 && !settled) {
            resolve(null);
          }
        });
    });
  });
}

/**
 * Like probeFirstReachable, but keeps retrying for up to `totalMs` (useful while
 * waiting for the converter to join a just-enabled hotspot and announce itself).
 */
export async function probeUntilReachable(
  baseUrls: string[],
  opts: {totalMs?: number; perTryMs?: number; intervalMs?: number} = {},
): Promise<string | null> {
  const total = opts.totalMs ?? 45000;
  const per = opts.perTryMs ?? 3000;
  const interval = opts.intervalMs ?? 2000;
  const deadline = Date.now() + total;
  while (Date.now() < deadline) {
    const url = await probeFirstReachable(baseUrls, per);
    if (url) {
      return url;
    }
    await delay(interval);
  }
  return null;
}

/**
 * Last resort when mDNS fails (e.g. finding the converter on an Android phone
 * hotspot, where `.local` resolution and client-IP enumeration aren't available
 * to apps): scan the likely hotspot subnets for a host whose `GET /api/info`
 * identifies as our converter (hostname === FIRMWARE_HOSTNAME).
 *
 * Scans, low-host-first, in parallel batches and stops at the first match:
 *   - any `extraSubnets` (e.g. derived from the phone's own IP) first,
 *   - 192.168.43.x (classic Android SoftAP),
 *   - 172.20.10.x (iOS personal hotspot, .2–.14).
 */
export async function scanForConverter(opts: {
  extraSubnets?: string[];
  includeCommonHotspotSubnets?: boolean;
  perTryMs?: number;
  batchSize?: number;
  onProgress?: (done: number, total: number) => void;
} = {}): Promise<string | null> {
  const perTry = opts.perTryMs ?? 1200;
  const batchSize = opts.batchSize ?? 32;
  const includeCommon = opts.includeCommonHotspotSubnets ?? true;

  const candidates: string[] = [];
  const pushRange = (subnet: string, lo: number, hi: number) => {
    for (let h = lo; h <= hi; h++) {
      candidates.push(`http://${subnet}.${h}`);
    }
  };

  const seen = new Set<string>();
  for (const subnet of opts.extraSubnets ?? []) {
    if (/^\d+\.\d+\.\d+$/.test(subnet) && !seen.has(subnet)) {
      seen.add(subnet);
      pushRange(subnet, 2, 254);
    }
  }
  if (includeCommon) {
    if (!seen.has('192.168.43')) {
      seen.add('192.168.43');
      pushRange('192.168.43', 2, 254); // classic Android SoftAP
    }
    pushRange('172.20.10', 2, 14); // iOS personal hotspot (/28)
  }

  const total = candidates.length;
  let done = 0;

  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async url => {
        try {
          const info = await getInfoAt(url, perTry);
          return info && info.hostname === FIRMWARE_HOSTNAME ? url : null;
        } catch {
          return null;
        }
      }),
    );
    done += batch.length;
    opts.onProgress?.(done, total);
    const hit = results.find(r => r !== null);
    if (hit) {
      return hit;
    }
  }
  return null;
}

/** Hand the user's home WiFi credentials to the firmware (active base URL). */
export async function postWifi(ssid: string, pass: string): Promise<void> {
  const res = await request(activeBaseUrl, '/api/wifi', {
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
      // keep default
    }
    throw new Error(message);
  }
}

export interface WaitForStationOptions {
  timeoutMs?: number;
  intervalMs?: number;
  onTick?: (info: FirmwareInfo | null) => void;
}

/**
 * Poll the active base URL until the firmware reports it joined the home WiFi
 * (`staOk` + a real `staIp`). Rejects on timeout (usually a wrong password).
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
