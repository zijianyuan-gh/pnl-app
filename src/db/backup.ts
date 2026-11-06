import { db as defaultDb, SCHEMA_VERSION, type DaybookDB } from './db';
import type { Account, CashFlow, Tombstone, Trade } from './types';
import { normalizeAccount, normalizeCashFlow, normalizeTrade } from './validate';
import { getSettings, saveSettings } from './actions';

export const BACKUP_APP = 'daybook-pnl-journal';
/** Bump when the backup JSON shape changes; add a converter to upgradeBackup(). */
export const BACKUP_FORMAT = 1;

export interface BackupSummary {
  accounts: number;
  trades: number;
  cashflows: number;
  /** Sum of all trade pnlCents — used as an integrity checksum. */
  netPnlCents: number;
}

export interface BackupFile {
  app: typeof BACKUP_APP;
  format: number;
  schemaVersion: number;
  exportedAt: string;
  summary: BackupSummary;
  data: {
    accounts: Account[];
    trades: Trade[];
    cashflows: CashFlow[];
    tombstones: Tombstone[];
  };
  settings: { lang: string | null };
}

export interface ParsedBackup {
  exportedAt: string | null;
  accounts: Account[];
  trades: Trade[];
  cashflows: CashFlow[];
  tombstones: Tombstone[];
  lang: string | null;
  summary: BackupSummary;
}

export function summarize(accounts: Account[], trades: Trade[], cashflows: CashFlow[]): BackupSummary {
  return {
    accounts: accounts.length,
    trades: trades.length,
    cashflows: cashflows.length,
    netPnlCents: trades.reduce((s, t) => s + t.pnlCents, 0),
  };
}

export async function buildBackup(d: DaybookDB = defaultDb): Promise<BackupFile> {
  return d.transaction('r', [d.accounts, d.trades, d.cashflows, d.tombstones, d.meta], async () => {
    const [accounts, trades, cashflows, tombstones, settings] = await Promise.all([
      d.accounts.toArray(),
      d.trades.toArray(),
      d.cashflows.toArray(),
      d.tombstones.toArray(),
      getSettings(d),
    ]);
    accounts.sort((a, b) => a.sortOrder - b.sortOrder);
    trades.sort((a, b) => (a.date === b.date ? a.createdAt - b.createdAt : a.date < b.date ? -1 : 1));
    cashflows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return {
      app: BACKUP_APP,
      format: BACKUP_FORMAT,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      summary: summarize(accounts, trades, cashflows),
      data: { accounts, trades, cashflows, tombstones },
      settings: { lang: settings.lang },
    };
  });
}

export function backupFileName(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `daybook-backup-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(date.getHours())}${p(
    date.getMinutes(),
  )}.json`;
}

/** Convert older backup formats to the current one. */
function upgradeBackup(raw: Record<string, unknown>): Record<string, unknown> {
  const format = Number(raw.format);
  // format 1 is current; future: if (format === 1) raw = v1ToV2(raw) …
  if (format === BACKUP_FORMAT) return raw;
  throw new Error(`unsupported_format:${format}`);
}

export type ParseBackupResult = { ok: true; backup: ParsedBackup; warnings: string[] } | { ok: false; error: string };

/** Strictly validate a backup file. Any invalid record rejects the whole file. */
export function parseBackup(text: string): ParseBackupResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'not_json' };
  }
  if (typeof raw !== 'object' || raw === null || (raw as Record<string, unknown>).app !== BACKUP_APP) {
    return { ok: false, error: 'not_backup' };
  }
  let obj: Record<string, unknown>;
  try {
    obj = upgradeBackup(raw as Record<string, unknown>);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const data = obj.data as Record<string, unknown> | undefined;
  if (!data || !Array.isArray(data.accounts) || !Array.isArray(data.trades) || !Array.isArray(data.cashflows)) {
    return { ok: false, error: 'missing_data' };
  }
  const accounts: Account[] = [];
  const trades: Trade[] = [];
  const cashflows: CashFlow[] = [];
  const ids = new Set<string>();
  const fail = (what: string, i: number, errs: string[]) => ({ ok: false as const, error: `invalid_record:${what}#${i + 1}: ${errs.join(', ')}` });

  for (let i = 0; i < data.accounts.length; i++) {
    const r = normalizeAccount(data.accounts[i]);
    if (!r.ok) return fail('account', i, r.errors);
    if (ids.has(r.value.id)) return fail('account', i, ['duplicate id']);
    ids.add(r.value.id);
    accounts.push(r.value);
  }
  const accountIds = new Set(accounts.map((a) => a.id));
  for (let i = 0; i < data.trades.length; i++) {
    const r = normalizeTrade(data.trades[i]);
    if (!r.ok) return fail('trade', i, r.errors);
    if (ids.has(r.value.id)) return fail('trade', i, ['duplicate id']);
    if (!accountIds.has(r.value.accountId)) return fail('trade', i, ['unknown account']);
    ids.add(r.value.id);
    trades.push(r.value);
  }
  for (let i = 0; i < data.cashflows.length; i++) {
    const r = normalizeCashFlow(data.cashflows[i]);
    if (!r.ok) return fail('cashflow', i, r.errors);
    if (ids.has(r.value.id)) return fail('cashflow', i, ['duplicate id']);
    if (!accountIds.has(r.value.accountId)) return fail('cashflow', i, ['unknown account']);
    ids.add(r.value.id);
    cashflows.push(r.value);
  }
  const tombstones: Tombstone[] = Array.isArray(data.tombstones)
    ? (data.tombstones as unknown[]).filter(
        (t): t is Tombstone =>
          typeof t === 'object' &&
          t !== null &&
          typeof (t as Tombstone).id === 'string' &&
          ['accounts', 'trades', 'cashflows'].includes((t as Tombstone).table) &&
          typeof (t as Tombstone).deletedAt === 'number',
      )
    : [];

  const summary = summarize(accounts, trades, cashflows);
  const warnings: string[] = [];
  const declared = obj.summary as Partial<BackupSummary> | undefined;
  if (declared) {
    if (
      declared.accounts !== summary.accounts ||
      declared.trades !== summary.trades ||
      declared.cashflows !== summary.cashflows ||
      declared.netPnlCents !== summary.netPnlCents
    ) {
      return { ok: false, error: 'checksum_mismatch' };
    }
  } else warnings.push('no_summary');

  const settings = obj.settings as { lang?: unknown } | undefined;
  const lang = settings?.lang === 'en' || settings?.lang === 'zh' ? settings.lang : null;
  return {
    ok: true,
    warnings,
    backup: {
      exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : null,
      accounts,
      trades,
      cashflows,
      tombstones,
      lang,
      summary,
    },
  };
}

export interface RestoreResult {
  accounts: number;
  trades: number;
  cashflows: number;
  skipped: number;
}

/**
 * Restore atomically. 'replace' wipes current data first. 'merge' upserts by id
 * (keeping whichever copy has the newer updatedAt) and never duplicates a record.
 */
export async function restoreBackup(
  b: ParsedBackup,
  mode: 'replace' | 'merge',
  d: DaybookDB = defaultDb,
): Promise<RestoreResult> {
  const result: RestoreResult = { accounts: 0, trades: 0, cashflows: 0, skipped: 0 };
  await d.transaction('rw', [d.accounts, d.trades, d.cashflows, d.tombstones, d.meta], async () => {
    if (mode === 'replace') {
      await Promise.all([d.accounts.clear(), d.trades.clear(), d.cashflows.clear(), d.tombstones.clear()]);
      await d.accounts.bulkPut(b.accounts);
      await d.trades.bulkPut(b.trades);
      await d.cashflows.bulkPut(b.cashflows);
      await d.tombstones.bulkPut(b.tombstones);
      result.accounts = b.accounts.length;
      result.trades = b.trades.length;
      result.cashflows = b.cashflows.length;
      if (b.lang) await saveSettings({ lang: b.lang as 'en' | 'zh' }, d);
      return;
    }
    const mergeTable = async <T extends { id: string; updatedAt: number }>(
      table: import('dexie').Table<T, string>,
      rows: T[],
      key: 'accounts' | 'trades' | 'cashflows',
    ) => {
      const existing = await table.bulkGet(rows.map((r) => r.id));
      const tombs = await d.tombstones.bulkGet(rows.map((r) => r.id));
      const toPut: T[] = [];
      rows.forEach((r, i) => {
        const cur = existing[i];
        const deletedLater = !cur && tombs[i] && tombs[i]!.deletedAt > r.updatedAt;
        if (!deletedLater && (!cur || r.updatedAt > cur.updatedAt)) toPut.push(r);
        else result.skipped++;
      });
      await table.bulkPut(toPut);
      result[key] = toPut.length;
    };
    await mergeTable(d.accounts as unknown as import('dexie').Table<Account, string>, b.accounts, 'accounts');
    await mergeTable(d.trades as unknown as import('dexie').Table<Trade, string>, b.trades, 'trades');
    await mergeTable(d.cashflows as unknown as import('dexie').Table<CashFlow, string>, b.cashflows, 'cashflows');
  });
  return result;
}
