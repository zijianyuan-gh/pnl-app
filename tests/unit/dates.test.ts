import { describe, expect, it } from 'vitest';
import {
  addDays, addMonths, daysInMonth, isValidISODate, monthEnd, monthGrid, monthRange, parseFlexibleDate,
  todayISO, weekday, formatDate,
} from '../../src/lib/dates';

describe('dates', () => {
  it('month lengths and leap years', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2025, 2)).toBe(28);
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
    expect(monthEnd('2024-02')).toBe('2024-02-29');
  });
  it('validates ISO dates strictly', () => {
    expect(isValidISODate('2024-02-29')).toBe(true);
    expect(isValidISODate('2025-02-29')).toBe(false);
    expect(isValidISODate('2026-04-31')).toBe(false);
    expect(isValidISODate('2026-13-01')).toBe(false);
    expect(isValidISODate('2026-1-01')).toBe(false);
  });
  it('day/month arithmetic across month, year and DST boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09'); // US DST start
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02'); // US DST end
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-05', -17)).toBe('2024-12');
    expect(monthRange('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
  it('builds Sunday-first grids', () => {
    // Nov 2026 starts on a Sunday, 30 days -> 5 rows
    const nov = monthGrid('2026-11');
    expect(nov[0][0]).toBe('2026-11-01');
    expect(nov.length).toBe(5);
    // Feb 2026: starts Sunday, 28 days -> exactly 4 rows
    expect(monthGrid('2026-02').length).toBe(4);
    // Aug 2026 starts Saturday -> 6 rows
    const aug = monthGrid('2026-08');
    expect(aug[0].slice(0, 6).every((c) => c === null)).toBe(true);
    expect(aug[0][6]).toBe('2026-08-01');
    expect(aug.length).toBe(6);
    expect(weekday('2026-11-06')).toBe(5);
  });
  it('todayISO uses local, not UTC, date', () => {
    // 23:30 local time on Dec 31 must still be Dec 31 regardless of UTC
    expect(todayISO(new Date(2026, 11, 31, 23, 30))).toBe('2026-12-31');
    expect(todayISO(new Date(2027, 0, 1, 0, 5))).toBe('2027-01-01');
  });
  it('formats plain dates without timezone drift', () => {
    expect(formatDate('2026-01-01', 'en-US', { month: 'short', day: 'numeric', year: 'numeric' })).toBe('Jan 1, 2026');
    expect(formatDate('2026-12-31', 'en-US', { month: 'short', day: 'numeric' })).toBe('Dec 31');
  });
  it('parses flexible import dates', () => {
    expect(parseFlexibleDate('2026-03-05')).toBe('2026-03-05');
    expect(parseFlexibleDate('2026/3/5')).toBe('2026-03-05');
    expect(parseFlexibleDate('20260305')).toBe('2026-03-05');
    expect(parseFlexibleDate('03/05/2026')).toBe('2026-03-05');
    expect(parseFlexibleDate('03/05/2026', 'dmy')).toBe('2026-05-03');
    expect(parseFlexibleDate('25/12/2026')).toBe('2026-12-25');
    expect(parseFlexibleDate('3/5/26')).toBe('2026-03-05');
    expect(parseFlexibleDate('2026-03-05 15:30:00')).toBe('2026-03-05');
    expect(parseFlexibleDate('2026-03-05T23:30:00')).toBe('2026-03-05');
    expect(parseFlexibleDate('Mar 5, 2026')).toBe('2026-03-05');
    expect(parseFlexibleDate('5 March 2026')).toBe('2026-03-05');
    expect(parseFlexibleDate('2026-02-30')).toBeNull();
    expect(parseFlexibleDate('13/13/2026')).toBeNull();
    expect(parseFlexibleDate('hello')).toBeNull();
  });
  it('converts offset datetimes to the local calendar date', () => {
    const iso = '2026-03-05T02:00:00Z';
    const d = new Date(iso);
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    expect(parseFlexibleDate(iso)).toBe(expected);
  });
});
