/**
 * Money helpers. All amounts are stored and computed as integer cents (USD).
 * Never do arithmetic on floating-point dollars.
 */
export type Cents = number;

export const MINUS = '−'; // typographic minus sign "−"

export type ParseMoneyResult =
  | { ok: true; cents: Cents; rounded: boolean; negative: boolean }
  | { ok: false; error: 'empty' | 'invalid' | 'too_large' };

const MAX_CENTS = 99_999_999_999_99; // $99.9 billion, well within Number.MAX_SAFE_INTEGER

/**
 * Parse a user-entered or CSV money string into integer cents without floating point.
 * Accepts: "1234.56", "$1,234.56", "-50", "−50", "+5", ".5", "(12.30)", "12.30-", "USD 5", "1 234.50",
 * and decimal-comma input from iPhones set to such regions: "12,5", "12,50", "1.234,56".
 * Separators must be unambiguous: "1,234" is one thousand two hundred thirty-four; "1,2,3" is rejected.
 * More than two decimal places are rounded half away from zero (flagged with `rounded`).
 */
export function parseMoney(raw: string | number | null | undefined): ParseMoneyResult {
  if (raw === null || raw === undefined) return { ok: false, error: 'empty' };
  let s = typeof raw === 'number' ? numberToPlainString(raw) : String(raw);
  s = s.trim();
  if (!s) return { ok: false, error: 'empty' };

  let negative = false;
  // Accounting negative: (123.45)
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  // Remove currency markers and unambiguous grouping characters (space, NBSP, apostrophe, underscore)
  s = s.replace(/usd/gi, '').replace(/[$\s\u00a0\u202f_']/g, '');
  s = s.replace(/[−‒–—﹣－]/g, '-');
  // Leading or trailing sign
  if (s.startsWith('+')) s = s.slice(1);
  else if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.endsWith('-')) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  const normalized = normalizeSeparators(s);
  if (normalized === null) return { ok: false, error: 'invalid' };
  s = normalized;
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return { ok: false, error: s ? 'invalid' : 'empty' };

  const [intPartRaw, fracRaw = ''] = s.split('.');
  const intPart = intPartRaw.replace(/^0+(?=\d)/, '') || '0';
  if (intPart.length > 13) return { ok: false, error: 'too_large' };
  let frac = fracRaw;
  let rounded = false;
  let cents = Number(intPart) * 100;
  if (frac.length <= 2) {
    cents += Number(frac.padEnd(2, '0') || '0');
  } else {
    rounded = /[1-9]/.test(frac.slice(2));
    const base = Number(frac.slice(0, 2));
    const roundUp = Number(frac[2]) >= 5;
    cents += base + (roundUp ? 1 : 0);
    frac = frac.slice(0, 2);
  }
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) return { ok: false, error: 'too_large' };
  const signed = negative && cents !== 0 ? -cents : cents;
  return { ok: true, cents: signed, rounded, negative: negative && cents !== 0 };
}

/** Resolve "," and "." into a single "." decimal point, or null if the grouping is malformed. */
function normalizeSeparators(s: string): string | null {
  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  if (hasDot && hasComma) {
    const dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
    const grp = dec === '.' ? ',' : '.';
    const i = s.lastIndexOf(dec);
    const intp = s.slice(0, i);
    const frac = s.slice(i + 1);
    if (intp.includes(dec) || frac.includes(grp)) return null;
    const grpRe = grp === ',' ? /^\d{1,3}(,\d{3})+$/ : /^\d{1,3}(\.\d{3})+$/;
    if (!grpRe.test(intp)) return null;
    return `${intp.split(grp).join('')}.${frac}`;
  }
  if (hasComma) {
    if (/^\d{1,3}(,\d{3})+$/.test(s)) return s.replace(/,/g, ''); // 1,234 / 12,345,678 → grouping
    if (/^\d*,\d{1,2}$/.test(s)) return s.replace(',', '.'); // 12,5 / 12,50 → decimal comma
    return null;
  }
  if (hasDot && s.indexOf('.') !== s.lastIndexOf('.')) {
    return /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, '') : null; // 1.234.567 → grouping
  }
  return s;
}

function numberToPlainString(n: number): string {
  if (!Number.isFinite(n)) return 'NaN';
  // Avoid exponent notation; 10 fraction digits is plenty to round to cents correctly.
  const s = n.toFixed(10);
  return s.replace(/\.?0+$/, '');
}

function groupThousands(intDigits: string): string {
  return intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export interface FormatOptions {
  /** 'always' shows + for positives, 'negative' only shows − for negatives, 'never' shows absolute value. */
  sign?: 'always' | 'negative' | 'never';
  /** Show cents. Default true. */
  cents?: boolean;
}

/** Exact formatting from integer cents: +$1,234.56 / −$50.00 / $0.00 */
export function formatMoney(cents: Cents, opts: FormatOptions = {}): string {
  const { sign = 'negative', cents: showCents = true } = opts;
  const c = Math.round(cents);
  const abs = Math.abs(c);
  let body: string;
  if (showCents) {
    const dollars = Math.floor(abs / 100);
    const rem = abs % 100;
    body = `$${groupThousands(String(dollars))}.${String(rem).padStart(2, '0')}`;
  } else {
    // round half away from zero to whole dollars
    const dollars = Math.floor((abs + 50) / 100);
    body = `$${groupThousands(String(dollars))}`;
  }
  const isZeroShown = showCents ? abs === 0 : Math.floor((abs + 50) / 100) === 0;
  if (sign === 'never' || isZeroShown) return body;
  if (c < 0) return `${MINUS}${body}`;
  if (sign === 'always') return `+${body}`;
  return body;
}

/**
 * Compact amount for tight calendar cells (<= 6 characters incl. sign). Always signed (except zero).
 * < $10: cents ("+$4.50"); < $1,000: whole dollars ("-$923"); < $10K: "+$1.2K"; < $1M: "+$12K";
 * then "+$1.2M" / "+$12M". K/M values are truncated toward zero so a result is never overstated.
 */
export function formatCompact(cents: Cents): string {
  const abs = Math.abs(cents);
  const sign = cents > 0 ? '+' : cents < 0 ? MINUS : '';
  let body: string;
  if (abs < 10_00) {
    body = abs % 100 === 0 ? `$${abs / 100}` : formatMoney(abs, { sign: 'never' });
  } else if (abs < 999_50) {
    body = `$${Math.floor((abs + 50) / 100)}`;
  } else if (abs < 10_000_00) {
    body = `$${trimDecimal(Math.max(1, abs / 1000_00), 1)}K`;
  } else if (abs < 1_000_000_00) {
    body = `$${Math.floor(abs / 1000_00)}K`;
  } else if (abs < 10_000_000_00) {
    body = `$${trimDecimal(abs / 1_000_000_00, 1)}M`;
  } else {
    body = `$${Math.floor(abs / 1_000_000_00)}M`;
  }
  if (body === '$0' || body === '$0.00') return '$0';
  return sign + body;
}

function trimDecimal(n: number, digits: number): string {
  // Truncate toward zero so we never overstate a result (e.g. $9,999 → $9.99K, not $10.00K)
  const f = 10 ** digits;
  const truncated = Math.floor(n * f + 1e-9) / f;
  return truncated.toFixed(digits).replace(/\.?0+$/, '');
}

/** Value suitable for an <input> when editing: "1234.56" (no sign, no grouping). */
export function centsToInput(cents: Cents): string {
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  return rem === 0 ? String(dollars) : `${dollars}.${String(rem).padStart(2, '0')}`;
}

/** Plain decimal string for CSV: "-1234.56" */
export function centsToDecimal(cents: Cents): string {
  const abs = Math.abs(Math.round(cents));
  const s = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return cents < 0 ? `-${s}` : s;
}

export function sumCents(values: Iterable<Cents>): Cents {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

/** Integer division rounded half away from zero (for averages in cents). */
export function divRound(numerator: Cents, denominator: number): Cents {
  if (denominator === 0) return 0;
  const sign = Math.sign(numerator) * Math.sign(denominator);
  const a = Math.abs(numerator);
  const b = Math.abs(denominator);
  const q = Math.floor(a / b);
  const r = a - q * b;
  return sign * (r * 2 >= b ? q + 1 : q);
}

export function pnlTone(cents: Cents): 'pos' | 'neg' | 'zero' {
  return cents > 0 ? 'pos' : cents < 0 ? 'neg' : 'zero';
}
