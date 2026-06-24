import {sha256} from 'js-sha256';
import {Buffer} from 'buffer';
import ReactNativeBlobUtil from 'react-native-blob-util';
import type {FirmwareReleaseInfo} from './githubReleases';

// ---------------------------------------------------------------------------
// Firmware OTA: download + verify the .bin from a GitHub release.
//
// The image (~1 MB) is streamed to cache (never held in JS memory) and its
// SHA256 is computed in chunks and compared to the release's .sha256 sidecar.
// firmwareOta.uploadFirmware() then POSTs the verified file to the converter.
// ---------------------------------------------------------------------------

const USER_AGENT = 'fj-ocs-setup/0.1.0';
const BIN_PREFIX = 'fj-ocs-firmware-';
const HASH_CHUNK_BUFFER_SIZE = 64 * 1024;

/** Thrown when the streamed SHA256 doesn't match the expected hash. */
export class IntegrityError extends Error {
  constructor(
    public readonly computed: string,
    public readonly expected: string,
  ) {
    super(
      `Integrity check failed: computed sha256=${computed} did not match expected sha256=${expected}`,
    );
    this.name = 'IntegrityError';
  }
}

export interface BinDownloadOpts {
  signal?: AbortSignal;
  onProgress?: (received: number, total: number) => void;
}

function binFileName(version: string): string {
  return `${BIN_PREFIX}${version}.bin`;
}

function binCachePath(version: string): string {
  return `${ReactNativeBlobUtil.fs.dirs.CacheDir}/${binFileName(version)}`;
}

/** Download the firmware .bin to local cache and return the on-disk path. */
export async function downloadFirmwareBin(
  release: FirmwareReleaseInfo,
  opts: BinDownloadOpts = {},
): Promise<string> {
  const {signal, onProgress} = opts;
  const path = binCachePath(release.version);

  try {
    if (await ReactNativeBlobUtil.fs.exists(path)) {
      await ReactNativeBlobUtil.fs.unlink(path);
    }
  } catch {
    // Non-fatal — fetch overwrites anyway.
  }

  const task = ReactNativeBlobUtil.config({
    path,
    fileCache: true,
    overwrite: true,
    timeout: 5 * 60_000,
  }).fetch('GET', release.binAssetUrl, {
    'User-Agent': USER_AGENT,
    Accept: 'application/octet-stream',
  });

  let abortListener: (() => void) | undefined;
  if (signal) {
    if (signal.aborted) {
      task.cancel();
      const err = new Error('Aborted');
      (err as any).name = 'AbortError';
      throw err;
    }
    abortListener = () => {
      try {
        task.cancel();
      } catch {
        /* ignore */
      }
    };
    signal.addEventListener('abort', abortListener);
  }

  if (onProgress) {
    task.progress(
      {count: 100},
      (received: string | number, total: string | number) => {
        const r = typeof received === 'string' ? parseInt(received, 10) : received;
        const t = typeof total === 'string' ? parseInt(total, 10) : total;
        onProgress(
          Number.isFinite(r) ? r : 0,
          Number.isFinite(t) && t > 0 ? t : release.binAssetSize ?? 0,
        );
      },
    );
  }

  let response;
  try {
    response = await task;
  } catch (e: any) {
    if (signal && abortListener) {
      signal.removeEventListener('abort', abortListener);
    }
    if (signal?.aborted) {
      const err = new Error('Aborted');
      (err as any).name = 'AbortError';
      throw err;
    }
    throw e;
  } finally {
    if (signal && abortListener) {
      signal.removeEventListener('abort', abortListener);
    }
  }

  const status = response.info().status;
  if (status < 200 || status >= 300) {
    const err: any = new Error(`Firmware download failed: HTTP ${status}`);
    err.status = status;
    try {
      await ReactNativeBlobUtil.fs.unlink(path);
    } catch {
      /* ignore */
    }
    throw err;
  }

  return response.path();
}

/** Fetch the .bin.sha256 sidecar and extract the 64-char hex digest. */
export async function fetchExpectedSha256(
  release: FirmwareReleaseInfo,
): Promise<string> {
  const response = await fetch(release.sha256AssetUrl, {
    method: 'GET',
    headers: {'User-Agent': USER_AGENT},
  });
  if (!response.ok) {
    const err: any = new Error(
      `Sha256 fetch failed: ${response.status} ${response.statusText}`,
    );
    err.status = response.status;
    throw err;
  }
  const raw = await response.text();
  const match = /[0-9a-fA-F]{64}/.exec(raw);
  if (!match) {
    throw new Error('Sha256 asset did not contain a 64-char hex digest');
  }
  return match[0].toLowerCase();
}

/** Stream the file through SHA256 and throw IntegrityError on mismatch. */
export async function computeAndVerifySha256(
  localPath: string,
  expectedHex: string,
  opts: {signal?: AbortSignal} = {},
): Promise<string> {
  const expected = expectedHex.toLowerCase();
  const computed = await streamSha256(localPath, opts.signal);
  if (computed !== expected) {
    throw new IntegrityError(computed, expected);
  }
  return computed;
}

function streamSha256(
  localPath: string,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const hasher = sha256.create();
    ReactNativeBlobUtil.fs
      .readStream(localPath, 'base64', HASH_CHUNK_BUFFER_SIZE)
      .then(stream => {
        let aborted = false;
        const onAbort = () => {
          aborted = true;
          try {
            (stream as any).closed = true;
          } catch {
            /* ignore */
          }
          const err = new Error('Aborted');
          (err as any).name = 'AbortError';
          reject(err);
        };
        if (signal) {
          if (signal.aborted) {
            return onAbort();
          }
          signal.addEventListener('abort', onAbort);
        }
        stream.onData((chunk: string | number[]) => {
          if (aborted) {
            return;
          }
          const b64 = typeof chunk === 'string' ? chunk : '';
          if (b64) {
            hasher.update(Buffer.from(b64, 'base64'));
          }
        });
        stream.onError((err: unknown) => {
          if (aborted) {
            return;
          }
          if (signal) {
            signal.removeEventListener('abort', onAbort);
          }
          reject(err instanceof Error ? err : new Error(String(err)));
        });
        stream.onEnd(() => {
          if (aborted) {
            return;
          }
          if (signal) {
            signal.removeEventListener('abort', onAbort);
          }
          resolve(hasher.hex().toLowerCase());
        });
        stream.open();
      })
      .catch(reject);
  });
}

/** Delete stale `fj-ocs-firmware-*.bin` files in the cache, keeping keepPath. */
export async function cleanupOldFirmware(
  keepPath: string | null = null,
): Promise<void> {
  try {
    const dir = ReactNativeBlobUtil.fs.dirs.CacheDir;
    const entries = await ReactNativeBlobUtil.fs.ls(dir);
    for (const name of entries) {
      if (!name.startsWith(BIN_PREFIX) || !name.endsWith('.bin')) {
        continue;
      }
      const full = `${dir}/${name}`;
      if (keepPath && full === keepPath) {
        continue;
      }
      try {
        await ReactNativeBlobUtil.fs.unlink(full);
      } catch (e) {
        console.warn('[firmwareDownload] failed to unlink stale bin', full, e);
      }
    }
  } catch (e) {
    console.warn('[firmwareDownload] cleanup pass failed:', e);
  }
}
