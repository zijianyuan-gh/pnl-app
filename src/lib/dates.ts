/**
 * Calendar-date helpers. Trading days are stored as plain local calendar dates "YYYY-MM-DD"
 * (no time, no timezone), so a trade can never drift to the previous/next day when the
 * device timezone or DST changes. All arithmetic is done in UTC on those plain dates.
 */
export type ISODate = string; // YYYY-MM-DD
export type MonthKey = string; // YYYY-MM

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** month is 1-12 */
export function daysInMonth(y: number, month: number): number {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

export function isValidISODate(s: unknown): s is ISODate {
  if (typeof s !== 'string') return false;
  const m = ISO_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return y >= 1900 && y <= 2200 && mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

export function toISODate(y: number, month: number, d: number): ISODate {
  return `${y}-${pad2(month)}-${pad2(d)}`;
}

export function parseISODate(s: ISODate): { y: number; m: number; d: number } {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}

/** The device's local calendar date (not UTC!). */
export function todayISO(now: Date = new Date()): ISODate {
  return toISODate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** Local calendar date of a JS Date (uses device timezone). */
export function dateToLocalISO(date: Date): ISODate {
  return toISODate(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function toUTCms(s: ISODate): number {
  const { y, m, d } = parseISODate(s);
  return Date.UTC(y, m - 1, d);
}

function fromUTCms(ms: number): ISODate {
  const dt = new Date(ms);
  return toISODate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addDays(s: ISODate, n: number): ISODate {
  return fromUTCms(toUTCms(s) + n * 86_400_000);
}

export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((toUTCms(a) - toUTCms(b)) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday */
export function weekday(s: ISODate): number {
  return new Date(toUTCms(s)).getUTCDay();
}

export function monthKeyOf(s: ISODate): MonthKey {
  return s.slice(0, 7);
}

export function parseMonthKey(k: MonthKey): { y: number; m: number } {
  const [y, m] = k.split('-').map(Number);
  return { y, m };
}

export function toMonthKey(y: number, m: number): MonthKey {
  return `${y}-${pad2(m)}`;
}

export function addMonths(k: MonthKey, n: number): MonthKey {
  const { y, m } = parseMonthKey(k);
  const idx = y * 12 + (m - 1) + n;
  return toMonthKey(Math.floor(idx / 12), (idx % 12) + 1);
}

export function monthStart(k: MonthKey): ISODate {
  return `${k}-01`;
}

export function monthEnd(k: MonthKey): ISODate {
  const { y, m } = parseMonthKey(k);
  return toISODate(y, m, daysInMonth(y, m));
}

/** Inclusive list of month keys from a to b. */
export function monthRange(a: MonthKey, b: MonthKey): MonthKey[] {
  const out: MonthKey[] = [];
  if (a > b) return out;
  let k = a;
  let guard = 0;
  while (k <= b && guard++ < 2400) {
    out.push(k);
    k = addMonths(k, 1);
  }
  return out;
}

/**
 * Sunday-first month grid. Returns weeks (rows) of 7 cells; cells outside the month are null.
 */
export function monthGrid(k: MonthKey): (ISODate | null)[][] {
  const { y, m } = parseMonthKey(k);
  const first = monthStart(k);
  const lead = weekday(first);
  const total = daysInMonth(y, m);
  const cells: (ISODate | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= total; d++) cells.push(toISODate(y, m, d));
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (ISODate | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Format a plain date for display without timezone drift. */
export function formatDate(
  s: ISODate,
  locale: string,
  opts: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' },
): string {
  return new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'UTC' }).format(new Date(toUTCms(s)));
}

export function formatMonth(k: MonthKey, locale: string, style: 'long' | 'short' = 'long'): string {
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: style, timeZone: 'UTC' }).format(
    new Date(toUTCms(monthStart(k))),
  );
}

export function isValidTime(s: unknown): s is string {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

export type DateOrder = 'auto' | 'mdy' | 'dmy' | 'ymd';

/**
 * Parse an imported date string to a plain ISO date.
 * - "2024-03-05", "2024/3/5", "20240305"
 * - "03/05/2024", "3/5/24" (mdy or dmy, per `order`)
 * - ISO datetimes: a value with an explicit offset/Z is converted to the device's local date;
 *   a value without offset uses its written date as-is.
 * - "Mar 5, 2024", "5 Mar 2024"
 */
export function parseFlexibleDate(raw: string, order: DateOrder = 'auto'): ISODate | null {
  const s = raw.trim();
  if (!s) return null;
  let m: RegExpExecArray | null;

  // ISO datetime with offset → local calendar date of that instant
  if ((m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})$/i.exec(s))) {
    const d = new Date(s.replace(' ', 'T'));
    if (Number.isNaN(d.getTime())) return null;
    const iso = dateToLocalISO(d);
    return isValidISODate(iso) ? iso : null;
  }
  // ISO date or naive datetime
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/.exec(s))) {
    const iso = toISODate(Number(m[1]), Number(m[2]), Number(m[3]));
    return isValidISODate(iso) ? iso : null;
  }
  if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) {
    const iso = toISODate(Number(m[1]), Number(m[2]), Number(m[3]));
    return isValidISODate(iso) ? iso : null;
  }
  // a/b/yyyy (optionally followed by time)
  if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:[ T,].*)?$/.exec(s))) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    let y = Number(m[3]);
    if (m[3].length === 2) y += y >= 70 ? 1900 : 2000;
    let month: number;
    let day: number;
    if (order === 'dmy') [day, month] = [a, b];
    else if (order === 'mdy' || order === 'ymd') [month, day] = [a, b];
    else if (a > 12 && b <= 12) [day, month] = [a, b];
    else [month, day] = [a, b];
    const iso = toISODate(y, month, day);
    return isValidISODate(iso) ? iso : null;
  }
  // Month-name formats
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  if ((m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(s))) {
    const mi = months.indexOf(m[1].slice(0, 3).toLowerCase());
    if (mi >= 0) {
      const iso = toISODate(Number(m[3]), mi + 1, Number(m[2]));
      return isValidISODate(iso) ? iso : null;
    }
  }
  if ((m = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})/.exec(s))) {
    const mi = months.indexOf(m[2].slice(0, 3).toLowerCase());
    if (mi >= 0) {
      const iso = toISODate(Number(m[3]), mi + 1, Number(m[1]));
      return isValidISODate(iso) ? iso : null;
    }
  }
  return null;
}
