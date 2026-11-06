import { isValidISODate, isValidTime } from '../lib/dates';
import { ACCOUNT_COLORS, type Account, type CashFlow, type Trade } from './types';

export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const MAX_ABS_CENTS = 99_999_999_999_99;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function str(v: unknown, max: number): string {
  if (v === null || v === undefined) return '';
  return String(v).trim().slice(0, max);
}

function optStr(v: unknown, max: number): string | null {
  const s = str(v, max);
  return s ? s : null;
}

function isCents(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && Math.abs(v) <= MAX_ABS_CENTS;
}

function ts(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

export function normalizeTags(v: unknown): string[] {
  const arr = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,;|]/) : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of arr) {
    const t = String(raw).trim().replace(/^#/, '').slice(0, 40);
    const key = t.toLowerCase();
    if (t && !seen.has(key)) {
      seen.add(key);
      out.push(t);
    }
    if (out.length >= 20) break;
  }
  return out;
}

export function normalizeAccount(v: unknown, now = Date.now()): Result<Account> {
  const errors: string[] = [];
  if (!isObj(v)) return { ok: false, errors: ['not an object'] };
  const id = str(v.id, 64);
  const name = str(v.name, 60);
  if (!id) errors.push('missing id');
  if (!name) errors.push('missing name');
  if (!isCents(v.startingBalanceCents)) errors.push('invalid startingBalanceCents');
  if (!isValidISODate(v.startDate)) errors.push('invalid startDate');
  if (errors.length) return { ok: false, errors };
  const color = typeof v.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.color) ? v.color : ACCOUNT_COLORS[0];
  return {
    ok: true,
    value: {
      id,
      name,
      startingBalanceCents: v.startingBalanceCents as number,
      startDate: v.startDate as string,
      color,
      archived: v.archived === true,
      sortOrder: typeof v.sortOrder === 'number' && Number.isFinite(v.sortOrder) ? v.sortOrder : 0,
      createdAt: ts(v.createdAt, now),
      updatedAt: ts(v.updatedAt, now),
    },
  };
}

export function normalizeTrade(v: unknown, now = Date.now()): Result<Trade> {
  const errors: string[] = [];
  if (!isObj(v)) return { ok: false, errors: ['not an object'] };
  const id = str(v.id, 64);
  const accountId = str(v.accountId, 64);
  if (!id) errors.push('missing id');
  if (!accountId) errors.push('missing accountId');
  if (!isValidISODate(v.date)) errors.push('invalid date');
  if (!isCents(v.pnlCents)) errors.push('invalid pnlCents');
  if (v.feesCents !== null && v.feesCents !== undefined && !(isCents(v.feesCents) && (v.feesCents as number) >= 0))
    errors.push('invalid feesCents');
  if (v.entryTime && !isValidTime(v.entryTime)) errors.push('invalid entryTime');
  if (v.exitTime && !isValidTime(v.exitTime)) errors.push('invalid exitTime');
  if (errors.length) return { ok: false, errors };
  const side = v.side === 'long' || v.side === 'short' ? v.side : null;
  return {
    ok: true,
    value: {
      id,
      accountId,
      date: v.date as string,
      pnlCents: v.pnlCents as number,
      feesCents: v.feesCents === null || v.feesCents === undefined ? null : (v.feesCents as number),
      symbol: str(v.symbol, 60),
      platform: str(v.platform, 60),
      tags: normalizeTags(v.tags),
      notes: str(v.notes, 2000),
      side,
      quantity: optStr(v.quantity, 30),
      entryPrice: optStr(v.entryPrice, 30),
      exitPrice: optStr(v.exitPrice, 30),
      entryTime: optStr(v.entryTime, 5),
      exitTime: optStr(v.exitTime, 5),
      createdAt: ts(v.createdAt, now),
      updatedAt: ts(v.updatedAt, now),
    },
  };
}

export function normalizeCashFlow(v: unknown, now = Date.now()): Result<CashFlow> {
  const errors: string[] = [];
  if (!isObj(v)) return { ok: false, errors: ['not an object'] };
  const id = str(v.id, 64);
  const accountId = str(v.accountId, 64);
  if (!id) errors.push('missing id');
  if (!accountId) errors.push('missing accountId');
  if (!isValidISODate(v.date)) errors.push('invalid date');
  if (v.type !== 'deposit' && v.type !== 'withdrawal') errors.push('invalid type');
  if (!isCents(v.amountCents) || (v.amountCents as number) <= 0) errors.push('invalid amountCents');
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      id,
      accountId,
      date: v.date as string,
      type: v.type as CashFlow['type'],
      amountCents: v.amountCents as number,
      notes: str(v.notes, 2000),
      createdAt: ts(v.createdAt, now),
      updatedAt: ts(v.updatedAt, now),
    },
  };
}

/** Duplicate-detection key: same account, day, net P&L and symbol. */
export function tradeFingerprint(t: Pick<Trade, 'accountId' | 'date' | 'pnlCents' | 'symbol'>): string {
  return `${t.accountId}|${t.date}|${t.pnlCents}|${t.symbol.trim().toUpperCase()}`;
}

export function cashFlowFingerprint(c: Pick<CashFlow, 'accountId' | 'date' | 'type' | 'amountCents'>): string {
  return `${c.accountId}|${c.date}|${c.type}|${c.amountCents}`;
}
