// Pure-JS semver helpers. No deps.
//
// Handles "0.1.0", "0.1.0+12" (build metadata ignored in compare),
// "0.1.0-rc.1" / "0.1.0-beta.3" prereleases, and the "0.0.0-dev" sentinel.
// Comparison follows https://semver.org (build metadata ignored).

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease?: {tag: string; num: number};
  build?: number;
}

const VERSION_REGEX =
  /^(\d+)\.(\d+)\.(\d+)(?:-([a-z][a-z0-9]*)(?:\.(\d+))?)?(?:\+(\d+))?$/i;

/** Parse a version string. Returns null for anything that doesn't match. */
export function parse(version: string): ParsedVersion | null {
  if (!version) {
    return null;
  }
  const cleaned = version.startsWith('v') ? version.slice(1) : version;
  const m = VERSION_REGEX.exec(cleaned);
  if (!m) {
    return null;
  }
  const [, major, minor, patch, preTag, preNum, build] = m;
  const result: ParsedVersion = {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
  };
  if (preTag !== undefined) {
    result.prerelease = {
      tag: preTag.toLowerCase(),
      num: preNum !== undefined ? Number(preNum) : 0,
    };
  }
  if (build !== undefined) {
    result.build = Number(build);
  }
  return result;
}

/**
 * Compare two semver-ish strings (build metadata ignored).
 * Returns -1 if a < b, 0 if equal, 1 if a > b. If one input is unparseable,
 * the parseable one wins; if both are, returns 0.
 */
export function compare(a: string, b: string): -1 | 0 | 1 {
  const pa = parse(a);
  const pb = parse(b);
  if (!pa && !pb) {
    return 0;
  }
  if (!pa) {
    return -1;
  }
  if (!pb) {
    return 1;
  }

  if (pa.major !== pb.major) {
    return pa.major < pb.major ? -1 : 1;
  }
  if (pa.minor !== pb.minor) {
    return pa.minor < pb.minor ? -1 : 1;
  }
  if (pa.patch !== pb.patch) {
    return pa.patch < pb.patch ? -1 : 1;
  }

  // Equal major.minor.patch — a release outranks a prerelease (semver §11.4).
  const aPre = pa.prerelease;
  const bPre = pb.prerelease;
  if (!aPre && !bPre) {
    return 0;
  }
  if (!aPre && bPre) {
    return 1;
  }
  if (aPre && !bPre) {
    return -1;
  }
  if (aPre!.tag !== bPre!.tag) {
    return aPre!.tag < bPre!.tag ? -1 : 1;
  }
  if (aPre!.num !== bPre!.num) {
    return aPre!.num < bPre!.num ? -1 : 1;
  }
  return 0;
}

/** Canonical user-visible version string, prefixed with exactly one "v". */
export function formatVersion(version: string | null | undefined): string {
  if (!version) {
    return 'Unknown';
  }
  if (version.startsWith('v') || version.startsWith('V')) {
    return version;
  }
  return `v${version}`;
}
