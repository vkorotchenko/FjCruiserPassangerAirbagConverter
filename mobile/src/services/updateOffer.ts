/**
 * updateOffer.ts — discriminated union describing what the update UI should
 * offer, given the running version (may be null/unknown) and the latest
 * fetched release version. No RN imports; trivially unit-testable.
 */
import {compare, parse} from './semver';

/** No latest release has been fetched yet. Show "Check for updates". */
export interface UpdateOfferNone {
  kind: 'none';
}

/** The running version is current (running >= latest). Show "Up to date". */
export interface UpdateOfferUpToDate {
  kind: 'up-to-date';
  current: string;
  latest: string;
}

/** A newer release is available. Show "Update to vX.Y.Z". */
export interface UpdateOfferUpdate {
  kind: 'update';
  current: string;
  latest: string;
}

/** Latest known but running version unreadable. Show "Install latest". */
export interface UpdateOfferUnknownCurrent {
  kind: 'unknown-current';
  latest: string;
}

export type UpdateOffer =
  | UpdateOfferNone
  | UpdateOfferUpToDate
  | UpdateOfferUpdate
  | UpdateOfferUnknownCurrent;

/**
 * Compute the update offer for the given current and latest version strings
 * (either may be null).
 */
export function computeUpdateOffer(
  currentVersion: string | null | undefined,
  latestVersion: string | null | undefined,
): UpdateOffer {
  if (!latestVersion) {
    return {kind: 'none'};
  }
  if (!currentVersion || !parse(currentVersion)) {
    return {kind: 'unknown-current', latest: latestVersion};
  }
  if (compare(latestVersion, currentVersion) === 1) {
    return {kind: 'update', current: currentVersion, latest: latestVersion};
  }
  return {kind: 'up-to-date', current: currentVersion, latest: latestVersion};
}
