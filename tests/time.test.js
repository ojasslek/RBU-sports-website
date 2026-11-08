import { describe, it, expect } from 'vitest';
import time from '../src/utils/time.js';

const {
  assertDateString,
  assertTimeString,
  collegeDateTimeToUtcIso,
  todayInCollege,
  addDaysToDateString,
  addMinutesToUtcIso,
  isFutureUtc
} = time;

describe('College timezone conversion', () => {
  it('converts 18:00 IST to 12:30 UTC on the same date', () => {
    expect(collegeDateTimeToUtcIso('2026-11-07', '18:00')).toBe(
      '2026-11-07T12:30:00.000Z'
    );
  });

  it('handles an early-morning slot that falls on the previous UTC date', () => {
    expect(collegeDateTimeToUtcIso('2026-11-08', '00:30')).toBe(
      '2026-11-07T19:00:00.000Z'
    );
  });

  it('uses the college date around the UTC midnight boundary', () => {
    // 18:29:59 UTC = 23:59:59 IST on 7 November.
    expect(todayInCollege(new Date('2026-11-07T18:29:59.000Z'))).toBe(
      '2026-11-07'
    );

    // 18:30:00 UTC = 00:00:00 IST on 8 November.
    expect(todayInCollege(new Date('2026-11-07T18:30:00.000Z'))).toBe(
      '2026-11-08'
    );
  });

  it('adds days across month, year and leap-day boundaries', () => {
    expect(addDaysToDateString('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToDateString('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDaysToDateString('2026-11-07', 7)).toBe('2026-11-14');
  });

  it('rejects impossible dates and invalid times', () => {
    expect(() => assertDateString('2026-02-30')).toThrow();
    expect(() => assertDateString('07-11-2026')).toThrow();
    expect(() => assertTimeString('24:00')).toThrow();
    expect(() => assertTimeString('18:60')).toThrow();
    expect(() => assertTimeString('6:00')).toThrow();
  });

  it('adds minutes to UTC timestamps for OTP and lock expiry', () => {
    expect(addMinutesToUtcIso('2026-11-07T10:00:00.000Z', 10)).toBe(
      '2026-11-07T10:10:00.000Z'
    );
    expect(addMinutesToUtcIso('2026-11-07T23:55:00.000Z', 15)).toBe(
      '2026-11-08T00:10:00.000Z'
    );
    expect(() => addMinutesToUtcIso('not-a-date', 10)).toThrow();
  });

  it('compares UTC timestamps as instants', () => {
    const now = '2026-11-07T10:00:00.000Z';
    expect(isFutureUtc('2026-11-07T10:00:01.000Z', now)).toBe(true);
    expect(isFutureUtc('2026-11-07T10:00:00.000Z', now)).toBe(false);
    expect(isFutureUtc('2026-11-07T09:59:59.000Z', now)).toBe(false);
    expect(isFutureUtc(null, now)).toBe(false);
  });
});
