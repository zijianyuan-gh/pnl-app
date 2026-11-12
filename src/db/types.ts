import type { Cents } from '../lib/money';
import type { ISODate } from '../lib/dates';

/**
 * Data model. Every record has a stable random UUID and timestamps so that a future
 * sync layer can merge by id/updatedAt; deletions are recorded as tombstones.
 */
export interface Account {
  id: string;
  name: string;
  /** Balance at the start of `startDate` (before any record dated on/after it). */
  startingBalanceCents: Cents;
  startDate: ISODate;
  color: string;
  archived: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export type TradeSide = 'long' | 'short';

export interface Trade {
  id: string;
  accountId: string;
  date: ISODate;
  /** Net realized P&L, fees already included. Positive = profit, negative = loss. */
  pnlCents: Cents;
  /** Informational only — already included in pnlCents, never subtracted again. */
  feesCents: Cents | null;
  symbol: string;
  platform: string;
  tags: string[];
  notes: string;
  side: TradeSide | null;
  quantity: string | null;
  entryPrice: string | null;
  exitPrice: string | null;
  entryTime: string | null; // HH:mm local
  exitTime: string | null; // HH:mm local
  createdAt: number;
  updatedAt: number;
}

export type CashFlowType = 'deposit' | 'withdrawal';

export interface CashFlow {
  id: string;
  accountId: string;
  date: ISODate;
  type: CashFlowType;
  /** Always positive; the direction is given by `type`. */
  amountCents: Cents;
  notes: string;
  createdAt: number;
  updatedAt: number;
}

export interface Tombstone {
  id: string;
  table: 'accounts' | 'trades' | 'cashflows';
  deletedAt: number;
}

export interface MetaRow {
  key: string;
  value: unknown;
}

export type Lang = 'en' | 'zh';

export interface Settings {
  lang: Lang | null; // null = follow device
  lastBackupAt: number | null;
  /** iOS app: require Face ID / Touch ID / passcode to open (a screen lock, not encryption) */
  appLock?: boolean;
  /** when the user last used "Erase all data" (older automatic copies are never offered back) */
  erasedAt?: number | null;
}

export const ACCOUNT_COLORS = [
  '#4F8CFF', // blue
  '#A78BFA', // violet
  '#F5B544', // amber
  '#2DD4BF', // teal
  '#F472B6', // pink
  '#FB923C', // orange
  '#94A3B8', // slate
  '#84CC16', // lime
];

export function newId(): string {
  const c: Crypto = globalThis.crypto;
  if (typeof c.randomUUID === 'function') return c.randomUUID();
  // Fallback (Safari < 15.4, or non-secure contexts): RFC4122 v4 from getRandomValues
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
