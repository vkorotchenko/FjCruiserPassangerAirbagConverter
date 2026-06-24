/**
 * @format
 * Unit tests for the pure self-update logic (no native modules).
 */
import {compare, parse, formatVersion} from '../src/services/semver';
import {computeUpdateOffer} from '../src/services/updateOffer';

describe('semver.compare', () => {
  test('orders by major.minor.patch, ignoring build metadata', () => {
    expect(compare('0.1.0', '0.0.9')).toBe(1);
    expect(compare('0.1.0+5', '0.1.0')).toBe(0);
    expect(compare('1.0.0', '0.99.99')).toBe(1);
  });

  test('release outranks prerelease', () => {
    expect(compare('0.1.0', '0.1.0-rc.1')).toBe(1);
    expect(compare('0.1.0-rc.2', '0.1.0-rc.1')).toBe(1);
  });

  test('parse rejects garbage', () => {
    expect(parse('not-a-version')).toBeNull();
  });
});

describe('semver.formatVersion', () => {
  test('prefixes exactly one v', () => {
    expect(formatVersion('0.1.0')).toBe('v0.1.0');
    expect(formatVersion('v0.1.0')).toBe('v0.1.0');
    expect(formatVersion(null)).toBe('Unknown');
  });
});

describe('computeUpdateOffer', () => {
  test('no latest release -> none', () => {
    expect(computeUpdateOffer('0.1.0', null).kind).toBe('none');
  });

  test('newer latest -> update', () => {
    const offer = computeUpdateOffer('0.1.0', '0.2.0');
    expect(offer.kind).toBe('update');
  });

  test('same/older latest -> up-to-date', () => {
    expect(computeUpdateOffer('0.2.0', '0.2.0').kind).toBe('up-to-date');
    expect(computeUpdateOffer('0.3.0', '0.2.0').kind).toBe('up-to-date');
  });

  test('unknown current with a latest -> unknown-current', () => {
    expect(computeUpdateOffer(null, '0.2.0').kind).toBe('unknown-current');
    expect(computeUpdateOffer('garbage', '0.2.0').kind).toBe('unknown-current');
  });
});
