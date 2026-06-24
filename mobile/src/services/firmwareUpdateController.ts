import {useAppStore} from '../store/useAppStore';
import {getInfo} from './firmwareApi';
import {
  fetchLatestFirmwareRelease,
  GithubReleasesNetworkError,
  GithubReleasesParseError,
  type FirmwareReleaseInfo,
} from './githubReleases';
import {
  downloadFirmwareBin,
  fetchExpectedSha256,
  computeAndVerifySha256,
  cleanupOldFirmware,
  IntegrityError,
} from './firmwareDownload';
import {uploadFirmware, waitForReboot} from './firmwareOta';

// ---------------------------------------------------------------------------
// Firmware OTA controller. Glue over the services that pushes results into the
// store and never throws.
// ---------------------------------------------------------------------------

export interface CheckResult {
  ok: boolean;
  hasRelease: boolean;
  errorMessage?: string;
}

/**
 * Read the converter's current firmware version (best-effort) and fetch the
 * latest `firmware-v*` GitHub release. Both land in the store.
 */
export async function checkForFirmwareUpdate(
  opts: {force?: boolean} = {},
): Promise<CheckResult> {
  const store = useAppStore.getState();
  const prevVersion = store.latestFwVersion;

  store.setFirmwareUpdateState('checking');
  store.setFirmwareUpdateError(null);

  // Current firmware version — only available when the converter is reachable.
  try {
    const info = await getInfo(4000);
    store.setFirmwareVersion(info.fwVersion ?? null);
  } catch {
    // Leave whatever we last knew; the UI shows "not connected".
  }

  try {
    const release = await fetchLatestFirmwareRelease(opts);
    const checkedAt = Date.now();

    if (release) {
      store.setLatestFirmwareRelease(
        {
          tag: release.tag,
          version: release.version,
          htmlUrl: release.htmlUrl,
          binAssetUrl: release.binAssetUrl,
          binAssetSize: release.binAssetSize,
          sha256AssetUrl: release.sha256AssetUrl,
          etag: release.etag,
        },
        checkedAt,
      );
    } else if (prevVersion !== null) {
      store.setLatestFirmwareRelease(null, checkedAt);
    } else {
      store.touchLatestFwCheckedAt(checkedAt);
    }

    store.setFirmwareUpdateState('idle');
    return {ok: true, hasRelease: release !== null};
  } catch (e: any) {
    let message: string;
    if (e instanceof GithubReleasesNetworkError) {
      message =
        e.status === 0
          ? 'No network — could not reach GitHub.'
          : `GitHub error ${e.status}.`;
    } else if (e instanceof GithubReleasesParseError) {
      message = 'Could not read GitHub response.';
    } else {
      message = e?.message ?? 'Update check failed.';
    }
    store.setFirmwareUpdateState('error');
    store.setFirmwareUpdateError(message);
    store.touchLatestFwCheckedAt(Date.now());
    return {ok: false, hasRelease: false, errorMessage: message};
  }
}

let activeAbort: AbortController | null = null;

/** Cancel an in-flight prepareAndFlashFirmware (download/verify only — once the
 *  upload to the converter starts it should not be interrupted). */
export function cancelFirmwareUpdate(): void {
  activeAbort?.abort();
}

function flashErrorMessage(e: unknown): string {
  if (e instanceof IntegrityError) {
    return 'Verification failed: the downloaded firmware was corrupt.';
  }
  const name = (e as any)?.name;
  const status = (e as any)?.status;
  if (name === 'AbortError') {
    return 'Cancelled.';
  }
  if (typeof status === 'number') {
    return status === 404 ? 'Release asset not found.' : `Server error: ${status}`;
  }
  return "Couldn't reach the network or the converter.";
}

/**
 * Download the latest firmware .bin, verify its SHA256, flash it to the
 * converter, and wait for the reboot. State transitions:
 *   downloading -> verifying -> flashing -> rebooting -> done
 * On failure -> error (message in store). Throws nothing.
 */
export async function prepareAndFlashFirmware(): Promise<void> {
  const store = useAppStore.getState();

  if (
    !store.latestFwBinUrl ||
    !store.latestFwSha256Url ||
    !store.latestFwVersion ||
    store.latestFwSize === null
  ) {
    store.setFirmwareUpdateState('error');
    store.setFirmwareUpdateError('No firmware release information available.');
    return;
  }

  const release: FirmwareReleaseInfo = {
    tag: store.latestFwTag ?? '',
    version: store.latestFwVersion,
    htmlUrl: store.latestFwUrl ?? '',
    binAssetUrl: store.latestFwBinUrl,
    binAssetSize: store.latestFwSize,
    sha256AssetUrl: store.latestFwSha256Url,
    releaseNotes: '',
    publishedAt: '',
    etag: store.latestFwEtag,
  };

  activeAbort?.abort();
  const abort = new AbortController();
  activeAbort = abort;

  store.setFirmwareUpdateError(null);

  // --- Download (needs internet) --------------------------------------------
  store.setFirmwareUpdateState('downloading');
  store.setFirmwareUpdateProgress(0, 0, release.binAssetSize);

  let localPath: string;
  let expectedHex: string;
  try {
    localPath = await downloadFirmwareBin(release, {
      signal: abort.signal,
      onProgress: (received, total) => {
        const s = useAppStore.getState();
        s.setFirmwareUpdateProgress(
          total > 0 ? Math.min(received / total, 1) : 0,
          received,
          total > 0 ? total : null,
        );
      },
    });
    expectedHex = await fetchExpectedSha256(release);
  } catch (e) {
    return finishWithError(e, abort);
  }
  if (activeAbort !== abort) {
    return;
  }

  // --- Verify ----------------------------------------------------------------
  store.setFirmwareUpdateState('verifying');
  store.setFirmwareUpdateProgress(1, null, null);
  try {
    await computeAndVerifySha256(localPath, expectedHex, {signal: abort.signal});
  } catch (e) {
    return finishWithError(e, abort);
  }
  if (activeAbort !== abort) {
    return;
  }

  // --- Flash (needs converter; must NOT be interrupted) ----------------------
  store.setFirmwareUpdateState('flashing');
  store.setFirmwareUpdateProgress(0, 0, null);
  try {
    await uploadFirmware(localPath, {
      onProgress: (sent, total) => {
        const s = useAppStore.getState();
        s.setFirmwareUpdateProgress(
          total > 0 ? Math.min(sent / total, 1) : 0,
          sent,
          total > 0 ? total : null,
        );
      },
    });
  } catch (e) {
    return finishWithError(e, abort);
  }

  // --- Reboot ----------------------------------------------------------------
  store.setFirmwareUpdateState('rebooting');
  store.setFirmwareUpdateProgress(1, null, null);
  const newVersion = await waitForReboot({});
  if (newVersion) {
    useAppStore.getState().setFirmwareVersion(newVersion);
  }

  activeAbort = null;
  const done = useAppStore.getState();
  done.setFirmwareUpdateState('done');
  done.setFirmwareUpdateError(null);
  cleanupOldFirmware(localPath).catch(() => {});
}

function finishWithError(e: unknown, abort: AbortController): void {
  if (activeAbort !== abort) {
    return;
  }
  activeAbort = null;
  const s = useAppStore.getState();
  if ((e as any)?.name === 'AbortError') {
    s.setFirmwareUpdateState('idle');
    s.setFirmwareUpdateError(null);
    s.resetFirmwareUpdateProgress();
    return;
  }
  s.setFirmwareUpdateState('error');
  s.setFirmwareUpdateError(flashErrorMessage(e));
  s.resetFirmwareUpdateProgress();
}
