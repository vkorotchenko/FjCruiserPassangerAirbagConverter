import {sha256} from 'js-sha256';
import {Buffer} from 'buffer';
import ReactNativeBlobUtil from 'react-native-blob-util';
import type {AppReleaseInfo} from './githubReleases';

// ---------------------------------------------------------------------------
// App self-update: download + verify the APK.
//
// The APK is tens of MB, so we stream it straight to disk (never hold it in JS
// memory) and compute SHA256 in chunks. The returned value is a file PATH that
// apkInstaller.installApk() consumes (wrapped in a FileProvider URI natively).
//
// Files are named `fj-ocs-setup-<version>.apk` in CacheDir so the cleanup pass
// can identify stale leftovers without a separate marker file.
// ---------------------------------------------------------------------------

const USER_AGENT = 'fj-ocs-setup/0.1.0';
const APK_PREFIX = 'fj-ocs-setup-';

// 64 KB base64 chunks (~48 KB raw after decode) — small enough that each
// Buffer.from(b64,'base64') stays cheap and the UI doesn't hitch.
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

export interface AppDownloadOpts {
  signal?: AbortSignal;
  onProgress?: (received: number, total: number) => void;
}

function apkFileName(version: string): string {
  return `${APK_PREFIX}${version}.apk`;
}

function apkCachePath(version: string): string {
  return `${ReactNativeBlobUtil.fs.dirs.CacheDir}/${apkFileName(version)}`;
}

/**
 * Download the APK to local cache and return the on-disk path. Streams directly
 * to disk via blob-util — never holds the full APK in JS memory. Throws on
 * non-2xx (error carries `.status`), network failure, or user abort.
 */
export async function downloadAppApk(
  release: AppReleaseInfo,
  opts: AppDownloadOpts = {},
): Promise<string> {
  const {signal, onProgress} = opts;
  const path = apkCachePath(release.version);

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
  }).fetch('GET', release.apkAssetUrl, {
    'User-Agent': USER_AGENT,
    Accept: 'application/vnd.android.package-archive',
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
          Number.isFinite(t) && t > 0 ? t : release.apkAssetSize ?? 0,
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
    const err: any = new Error(`APK download failed: HTTP ${status}`);
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

/** Fetch the .apk.sha256 sidecar and extract the 64-char hex digest. */
export async function fetchAppExpectedSha256(
  release: AppReleaseInfo,
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

/**
 * Stream the APK at `localPath` through a SHA256 hasher and compare to
 * `expectedHex`. Returns true on match, false on mismatch. Honors opts.signal
 * between chunks.
 */
export async function verifyAppApkSha256(
  localPath: string,
  expectedHex: string,
  opts: {signal?: AbortSignal} = {},
): Promise<boolean> {
  const expected = expectedHex.toLowerCase();
  const hasher = sha256.create();

  const stream = await ReactNativeBlobUtil.fs.readStream(
    localPath,
    'base64',
    HASH_CHUNK_BUFFER_SIZE,
  );

  return new Promise<boolean>((resolve, reject) => {
    let aborted = false;

    const abortListener = () => {
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
    if (opts.signal) {
      if (opts.signal.aborted) {
        return abortListener();
      }
      opts.signal.addEventListener('abort', abortListener);
    }

    stream.onData((chunk: string | number[]) => {
      if (aborted) {
        return;
      }
      const b64 = typeof chunk === 'string' ? chunk : '';
      if (!b64) {
        return;
      }
      hasher.update(Buffer.from(b64, 'base64'));
    });

    stream.onError((err: unknown) => {
      if (aborted) {
        return;
      }
      if (opts.signal) {
        opts.signal.removeEventListener('abort', abortListener);
      }
      reject(err instanceof Error ? err : new Error(String(err)));
    });

    stream.onEnd(() => {
      if (aborted) {
        return;
      }
      if (opts.signal) {
        opts.signal.removeEventListener('abort', abortListener);
      }
      resolve(hasher.hex().toLowerCase() === expected);
    });

    stream.open();
  });
}

/** Verify and throw IntegrityError on mismatch; returns the computed hash. */
export async function computeAndVerifyAppSha256(
  localPath: string,
  expectedHex: string,
  opts: {signal?: AbortSignal} = {},
): Promise<string> {
  const expected = expectedHex.toLowerCase();
  const matched = await verifyAppApkSha256(localPath, expected, opts);
  if (!matched) {
    // Re-stream to surface the actual computed hash in the error (rare path).
    const second = sha256.create();
    const stream = await ReactNativeBlobUtil.fs.readStream(
      localPath,
      'base64',
      HASH_CHUNK_BUFFER_SIZE,
    );
    const computed = await new Promise<string>((resolve, reject) => {
      stream.onData((chunk: string | number[]) => {
        const b64 = typeof chunk === 'string' ? chunk : '';
        if (b64) {
          second.update(Buffer.from(b64, 'base64'));
        }
      });
      stream.onError((err: unknown) =>
        reject(err instanceof Error ? err : new Error(String(err))),
      );
      stream.onEnd(() => resolve(second.hex().toLowerCase()));
      stream.open();
    });
    throw new IntegrityError(computed, expected);
  }
  return expected;
}

/**
 * Delete stale `fj-ocs-setup-*.apk` files in the cache dir, keeping `keepPath`
 * (if provided). Safe to call on launch — never throws.
 */
export async function cleanupOldApks(
  keepPath: string | null = null,
): Promise<void> {
  try {
    const dir = ReactNativeBlobUtil.fs.dirs.CacheDir;
    const entries = await ReactNativeBlobUtil.fs.ls(dir);
    for (const name of entries) {
      if (!name.startsWith(APK_PREFIX) || !name.endsWith('.apk')) {
        continue;
      }
      const full = `${dir}/${name}`;
      if (keepPath && full === keepPath) {
        continue;
      }
      try {
        await ReactNativeBlobUtil.fs.unlink(full);
      } catch (e) {
        console.warn('[mobileAppDownload] failed to unlink stale APK', full, e);
      }
    }
  } catch (e) {
    console.warn('[mobileAppDownload] cleanup pass failed:', e);
  }
}
