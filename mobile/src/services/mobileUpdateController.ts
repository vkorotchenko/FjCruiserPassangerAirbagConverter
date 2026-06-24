import {useAppStore} from '../store/useAppStore';
import {
  fetchLatestMobileRelease,
  GithubReleasesNetworkError,
  GithubReleasesParseError,
  type AppReleaseInfo,
} from './githubReleases';
import {
  downloadAppApk,
  fetchAppExpectedSha256,
  computeAndVerifyAppSha256,
  cleanupOldApks,
  IntegrityError,
} from './mobileAppDownload';

// ---------------------------------------------------------------------------
// App self-update controller. Thin glue over the services that pushes results
// into the store and never throws. Callsites:
//   - App mount (App.tsx) — fire-and-forget, non-forced
//   - "Check for updates" button — forced, awaitable
// ---------------------------------------------------------------------------

export interface CheckForAppUpdateResult {
  ok: boolean;
  hasRelease: boolean;
  errorMessage?: string;
}

export async function checkForMobileUpdate(
  opts: {force?: boolean} = {},
): Promise<CheckForAppUpdateResult> {
  const store = useAppStore.getState();
  const prevVersion = store.latestAppReleaseVersion;

  store.setAppUpdateState('checking');
  store.setAppUpdateError(null);

  try {
    const release = await fetchLatestMobileRelease(opts);
    const checkedAt = Date.now();

    if (release) {
      store.setLatestAppRelease(
        {
          tag: release.tag,
          version: release.version,
          htmlUrl: release.htmlUrl,
          apkAssetUrl: release.apkAssetUrl,
          apkAssetSize: release.apkAssetSize,
          sha256AssetUrl: release.sha256AssetUrl,
          etag: release.etag,
        },
        checkedAt,
      );
    } else if (prevVersion !== null) {
      // Release was deleted upstream — clear the cached entry.
      store.setLatestAppRelease(null, checkedAt);
    } else {
      store.touchLatestAppReleaseCheckedAt(checkedAt);
    }

    store.setAppUpdateState('idle');
    return {ok: true, hasRelease: release !== null};
  } catch (e: any) {
    const checkedAt = Date.now();
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
    store.setAppUpdateState('error');
    store.setAppUpdateError(message);
    store.touchLatestAppReleaseCheckedAt(checkedAt);
    return {ok: false, hasRelease: false, errorMessage: message};
  }
}

// ---------------------------------------------------------------------------
// Download + verify orchestration. The verified APK path is exposed via
// getReadyAppApkPath() — apkInstaller.installApk() is the only consumer.
// ---------------------------------------------------------------------------

let readyAppApkPath: string | null = null;
let readyAppApkSha256Hex: string | null = null;
let activeAppAbortController: AbortController | null = null;

export function getReadyAppApkPath(): string | null {
  return readyAppApkPath;
}

export function getReadyAppApkSha256(): string | null {
  return readyAppApkSha256Hex;
}

/** Cancel an in-flight prepareAppPayload, returning state to idle. */
export function cancelAppUpdatePreparation(): void {
  activeAppAbortController?.abort();
}

function appDownloadErrorMessage(e: unknown): string {
  if (e instanceof IntegrityError) {
    return 'Verification failed: hash mismatch';
  }
  const name = (e as any)?.name;
  const status = (e as any)?.status;
  if (name === 'AbortError') {
    return 'Cancelled.';
  }
  if (typeof status === 'number') {
    return status === 404 ? 'Release asset not found' : `Server error: ${status}`;
  }
  return "No network — couldn't reach GitHub.";
}

/**
 * Download the latest release APK, verify its SHA256 (streamed), and stash the
 * on-disk path for installApk(). State: idle/error → downloading → verifying →
 * ready. On failure → error (message in store). Throws nothing.
 */
export async function prepareAppPayload(): Promise<void> {
  const store = useAppStore.getState();

  if (
    !store.latestAppReleaseAssetUrl ||
    !store.latestAppReleaseSha256Url ||
    !store.latestAppReleaseVersion ||
    store.latestAppReleaseSize === null
  ) {
    store.setAppUpdateState('error');
    store.setAppUpdateError('No release information available.');
    return;
  }

  const release: AppReleaseInfo = {
    tag: store.latestAppReleaseTag ?? '',
    version: store.latestAppReleaseVersion,
    htmlUrl: store.latestAppReleaseUrl ?? '',
    apkAssetUrl: store.latestAppReleaseAssetUrl,
    apkAssetSize: store.latestAppReleaseSize,
    sha256AssetUrl: store.latestAppReleaseSha256Url,
    releaseNotes: '',
    publishedAt: '',
    etag: store.latestAppReleaseEtag,
  };

  activeAppAbortController?.abort();
  const abortController = new AbortController();
  activeAppAbortController = abortController;

  readyAppApkPath = null;
  readyAppApkSha256Hex = null;

  store.setAppUpdateError(null);
  store.setAppUpdateState('downloading');
  store.setAppUpdateProgress(0, 0, release.apkAssetSize);

  let localPath: string;
  let expectedHex: string;
  try {
    localPath = await downloadAppApk(release, {
      signal: abortController.signal,
      onProgress: (received, total) => {
        if (activeAppAbortController !== abortController) {
          return;
        }
        const s = useAppStore.getState();
        s.setAppUpdateProgress(
          total > 0 ? Math.min(received / total, 1) : 0,
          received,
          total > 0 ? total : null,
        );
      },
    });
    expectedHex = await fetchAppExpectedSha256(release);
  } catch (e) {
    if (activeAppAbortController !== abortController) {
      return;
    }
    activeAppAbortController = null;
    const s = useAppStore.getState();
    if ((e as any)?.name === 'AbortError') {
      s.setAppUpdateState('idle');
      s.setAppUpdateError(null);
      s.resetAppUpdateProgress();
      return;
    }
    s.setAppUpdateState('error');
    s.setAppUpdateError(appDownloadErrorMessage(e));
    s.resetAppUpdateProgress();
    return;
  }

  if (activeAppAbortController !== abortController) {
    return;
  }

  const verifyStore = useAppStore.getState();
  verifyStore.setAppUpdateState('verifying');
  verifyStore.setAppUpdateProgress(1, null, null);

  let computedHex: string;
  try {
    computedHex = await computeAndVerifyAppSha256(localPath, expectedHex, {
      signal: abortController.signal,
    });
  } catch (e) {
    if (activeAppAbortController !== abortController) {
      return;
    }
    activeAppAbortController = null;
    const s = useAppStore.getState();
    if ((e as any)?.name === 'AbortError') {
      s.setAppUpdateState('idle');
      s.setAppUpdateError(null);
      s.resetAppUpdateProgress();
      return;
    }
    s.setAppUpdateState('error');
    s.setAppUpdateError(appDownloadErrorMessage(e));
    s.resetAppUpdateProgress();
    return;
  }

  if (activeAppAbortController !== abortController) {
    return;
  }
  readyAppApkPath = localPath;
  readyAppApkSha256Hex = computedHex;
  activeAppAbortController = null;
  const readyStore = useAppStore.getState();
  readyStore.setAppUpdateState('ready');
  readyStore.setAppUpdateError(null);
  cleanupOldApks(localPath).catch(() => {});
}
