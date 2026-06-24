import AsyncStorage from '@react-native-async-storage/async-storage';
import {compare, parse} from './semver';

// ---------------------------------------------------------------------------
// GitHub Releases lookup for the converter FIRMWARE.
//
// Contract (.github/workflows/firmware-release.yml):
//   - Tag shape: firmware-vMAJOR.MINOR.PATCH[-(rc|beta|alpha).N]
//   - Repo:      vkorotchenko/FjCruiserPassangerAirbagConverter
//   - Assets:    fj-ocs-firmware-<version>.bin
//                fj-ocs-firmware-<version>.bin.sha256
//
// This module only DETECTS the latest release. Download + verify live in
// firmwareDownload; flashing lives in firmwareOta.
// ---------------------------------------------------------------------------

const USER_AGENT = 'fj-ocs-setup/0.1.0';
const TTL_MS = 60 * 60 * 1_000; // 1 hour

const RELEASES_REPO = 'vkorotchenko/FjCruiserPassangerAirbagConverter';
const TAG_PREFIX = 'firmware-v';
const TAG_REGEX = /^firmware-v(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)\.(\d+))?$/;
const STORAGE_KEY = 'fjocs.gh.releases.firmware.v1';
const BIN_SUFFIX = '.bin';
const SHA256_SUFFIX = '.bin.sha256';

export class GithubReleasesNetworkError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'GithubReleasesNetworkError';
  }
}
export class GithubReleasesParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GithubReleasesParseError';
  }
}

export interface FirmwareReleaseInfo {
  tag: string; // full tag, e.g. "firmware-v1.0.1"
  version: string; // bare version, e.g. "1.0.1"
  htmlUrl: string;
  binAssetUrl: string;
  binAssetSize: number; // bytes
  sha256AssetUrl: string;
  releaseNotes: string;
  publishedAt: string;
  etag: string | null;
}

interface CachedEntry {
  fetchedAt: number;
  release: FirmwareReleaseInfo | null;
  etag: string | null;
}

interface GithubAsset {
  name: string;
  size: number;
  browser_download_url: string;
}
interface GithubRelease {
  tag_name: string;
  html_url: string;
  body: string | null;
  published_at: string;
  prerelease: boolean;
  assets: GithubAsset[];
}

let memCache: CachedEntry | null | undefined;

async function loadCache(): Promise<CachedEntry | null> {
  if (memCache !== undefined) {
    return memCache ?? null;
  }
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      memCache = null;
      return null;
    }
    const parsed = JSON.parse(raw) as CachedEntry;
    memCache = parsed;
    return parsed;
  } catch {
    return null;
  }
}

async function saveCache(entry: CachedEntry): Promise<void> {
  memCache = entry;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // Non-fatal — in-memory cache still works for this session.
  }
}

function pickLatestRelease(
  releases: GithubRelease[],
): {release: GithubRelease; tag: string; version: string} | null {
  const candidates: Array<{
    release: GithubRelease;
    tag: string;
    version: string;
  }> = [];

  for (const r of releases) {
    if (r.prerelease) {
      continue;
    }
    const m = TAG_REGEX.exec(r.tag_name);
    if (!m || m[4]) {
      continue;
    }
    const version = r.tag_name.slice(TAG_PREFIX.length);
    if (!parse(version)) {
      continue;
    }
    candidates.push({release: r, tag: r.tag_name, version});
  }

  if (candidates.length === 0) {
    return null;
  }
  candidates.sort((a, b) => -compare(a.version, b.version));
  return candidates[0];
}

function buildReleaseInfo(
  picked: {release: GithubRelease; tag: string; version: string},
  etag: string | null,
): FirmwareReleaseInfo | null {
  const {release, tag, version} = picked;
  const secondary = release.assets.find(a => a.name.endsWith(SHA256_SUFFIX));
  const primary = release.assets.find(
    a => a.name.endsWith(BIN_SUFFIX) && !a.name.endsWith(SHA256_SUFFIX),
  );
  if (!primary || !secondary) {
    return null; // release exists but missing required assets
  }
  return {
    tag,
    version,
    htmlUrl: release.html_url,
    binAssetUrl: primary.browser_download_url,
    binAssetSize: primary.size,
    sha256AssetUrl: secondary.browser_download_url,
    releaseNotes: release.body ?? '',
    publishedAt: release.published_at,
    etag,
  };
}

/**
 * Fetch the newest non-prerelease `firmware-v*` release. Honors a 1-hour TTL
 * cache, sends `If-None-Match`, returns null when no eligible release exists,
 * and throws typed errors for transport / parse failures.
 */
export async function fetchLatestFirmwareRelease(
  opts: {force?: boolean} = {},
): Promise<FirmwareReleaseInfo | null> {
  const cached = await loadCache();
  const now = Date.now();

  if (!opts.force && cached && now - cached.fetchedAt < TTL_MS) {
    return cached.release;
  }

  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (cached?.etag) {
    headers['If-None-Match'] = cached.etag;
  }

  const url = `https://api.github.com/repos/${RELEASES_REPO}/releases?per_page=10`;

  let response: Response;
  try {
    response = await fetch(url, {method: 'GET', headers});
  } catch (e: any) {
    throw new GithubReleasesNetworkError(0, e?.message ?? 'Network request failed');
  }

  if (response.status === 304) {
    if (cached) {
      const refreshed: CachedEntry = {...cached, fetchedAt: now};
      await saveCache(refreshed);
      return refreshed.release;
    }
    return null;
  }

  if (!response.ok) {
    throw new GithubReleasesNetworkError(
      response.status,
      `GitHub releases fetch failed: ${response.status} ${response.statusText}`,
    );
  }

  const etag = response.headers.get('ETag');

  let json: GithubRelease[];
  try {
    json = (await response.json()) as GithubRelease[];
  } catch (e: any) {
    throw new GithubReleasesParseError(
      `GitHub releases JSON parse failed: ${e?.message ?? 'unknown'}`,
    );
  }
  if (!Array.isArray(json)) {
    throw new GithubReleasesParseError('GitHub releases response was not an array');
  }

  const picked = pickLatestRelease(json);
  const release = picked ? buildReleaseInfo(picked, etag) : null;

  await saveCache({fetchedAt: now, release, etag});
  return release;
}

/** For tests / debugging. Clears the in-memory and persisted release cache. */
export async function _clearReleasesCache(): Promise<void> {
  memCache = undefined;
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
