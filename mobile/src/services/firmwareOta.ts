import ReactNativeBlobUtil from 'react-native-blob-util';
import {getActiveBaseUrl, getInfoAt} from './firmwareApi';

// ---------------------------------------------------------------------------
// Firmware OTA: upload a verified .bin to the converter's POST /api/ota and
// wait for it to reboot into the new image.
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export interface UploadOpts {
  signal?: AbortSignal;
  onProgress?: (sent: number, total: number) => void;
}

/**
 * Upload the firmware image at `localPath` to the converter (active base URL)
 * as a multipart/form-data file. Throws on a non-2xx status, a `{ok:false}`
 * body, network failure, or user abort. On success the converter reboots.
 */
export async function uploadFirmware(
  localPath: string,
  opts: UploadOpts = {},
): Promise<void> {
  const {signal, onProgress} = opts;
  const baseUrl = getActiveBaseUrl();

  const task = ReactNativeBlobUtil.fetch(
    'POST',
    `${baseUrl}/api/ota`,
    {'Content-Type': 'multipart/form-data'},
    [
      {
        name: 'firmware',
        filename: 'firmware.bin',
        type: 'application/octet-stream',
        data: ReactNativeBlobUtil.wrap(localPath),
      },
    ],
  );

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
    task.uploadProgress({interval: 250}, (written, total) => {
      const w = typeof written === 'string' ? parseInt(written, 10) : written;
      const t = typeof total === 'string' ? parseInt(total, 10) : total;
      onProgress(
        Number.isFinite(w) ? w : 0,
        Number.isFinite(t) && t > 0 ? t : 0,
      );
    });
  }

  let response;
  try {
    response = await task;
  } catch (e: any) {
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
    const err: any = new Error(`OTA upload failed: HTTP ${status}`);
    err.status = status;
    throw err;
  }
  // The firmware replies {"ok":true} / {"ok":false,...}.
  try {
    const body = response.json() as {ok?: boolean; err?: string};
    if (body && body.ok === false) {
      throw new Error(body.err || 'Converter rejected the firmware image');
    }
  } catch (e) {
    if (e instanceof Error && /rejected|image/i.test(e.message)) {
      throw e;
    }
    // Non-JSON body is tolerated as long as the status was 2xx.
  }
}

/**
 * Wait for the converter to reboot into new firmware and come back online.
 * Resolves with the firmware version it reports (may equal `prevVersion` on a
 * re-flash), or null if it doesn't return within `timeoutMs`.
 */
export async function waitForReboot(
  opts: {timeoutMs?: number} = {},
): Promise<string | null> {
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const baseUrl = getActiveBaseUrl();
  const deadline = Date.now() + timeoutMs;

  // Give the device a moment to actually drop offline before we start polling,
  // so we don't immediately re-read the pre-reboot firmware.
  await delay(3000);

  while (Date.now() < deadline) {
    try {
      const info = await getInfoAt(baseUrl, 4000);
      return info.fwVersion ?? null;
    } catch {
      // still rebooting / temporarily unreachable
    }
    await delay(2500);
  }
  return null;
}
