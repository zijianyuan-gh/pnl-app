import { db as defaultDb, SCHEMA_VERSION, type DaybookDB } from './db';
import type { Account, CashFlow, Tombstone, Trade } from './types';
import { normalizeAccount, normalizeCashFlow, normalizeTrade } from './validate';
import { getSettings, saveSettings } from './actions';
import { CANONICAL_SCHEME, canonicalDigest, canonicalJSON } from '../lib/digest';

export const BACKUP_APP = 'daybook-pnl-journal';
/**
 * Backup file format history:
 *  1 (v1.0)  summary only (counts + net P&L) — accepted, verified with the weaker legacy check
 *  2 (v1.1)  adds `integrity`: SHA-256 over the canonical JSON of the whole file (minus `integrity`)
 * Bump when the shape changes and add a converter to upgradeBackup().
 */
export const BACKUP_FORMAT = 2;
const OLDEST_SUPPORTED_FORMAT = 1;

export interface BackupSummary {
  accounts: number;
  trades: number;
  cashflows: number;
  /** Sum of all trade pnlCents. */
  netPnlCents: number;
}

export interface BackupIntegrity {
  algorithm: 'SHA-256';
  scheme: typeof CANONICAL_SCHEME;
  /** hex digest of canonicalJSON(file without the `integrity` key) */
  digest: string;
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
  integrity: BackupIntegrity;
}

export type IntegrityLevel = 'sha256' | 'legacy-summary';

export interface ParsedBackup {
  format: number;
  exportedAt: string | null;
  accounts: Account[];
  trades: Trade[];
  cashflows: CashFlow[];
  tombstones: Tombstone[];
  lang: string | null;
  summary: BackupSummary;
  integrity: IntegrityLevel;
}

export function summarize(accounts: Account[], trades: Trade[], cashflows: CashFlow[]): BackupSummary {
  return {
    accounts: accounts.length,
    trades: trades.length,
    cashflows: cashflows.length,
    netPnlCents: trades.reduce((s, t) => s + t.pnlCents, 0),
  };
}

function withoutIntegrity(obj: Record<string, unknown>): Record<string, unknown> {
  const { integrity: _ignored, ...rest } = obj;
  return rest;
}

export async function buildBackup(d: DaybookDB = defaultDb): Promise<BackupFile> {
  const body = await d.transaction('r', [d.accounts, d.trades, d.cashflows, d.tombstones, d.meta], async () => {
    const [accounts, trades, cashflows, tombstones, settings] = await Promise.all([
      d.accounts.toArray(),
      d.trades.toArray(),
      d.cashflows.toArray(),
      d.tombstones.toArray(),
      getSettings(d),
    ]);
    accounts.sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt);
    trades.sort((a, b) => (a.date === b.date ? a.createdAt - b.createdAt : a.date < b.date ? -1 : 1));
    cashflows.sort((a, b) => (a.date === b.date ? a.createdAt - b.createdAt : a.date < b.date ? -1 : 1));
    tombstones.sort((a, b) => a.deletedAt - b.deletedAt || (a.id < b.id ? -1 : 1));
    return {
      app: BACKUP_APP,
      format: BACKUP_FORMAT,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      summary: summarize(accounts, trades, cashflows),
      data: { accounts, trades, cashflows, tombstones },
      settings: { lang: settings.lang },
    } as const;
  });
  // Round-trip through JSON so the digest covers exactly what will be written to the file.
  const plain = JSON.parse(JSON.stringify(body)) as Omit<BackupFile, 'integrity'>;
  return {
    ...plain,
    integrity: { algorithm: 'SHA-256', scheme: CANONICAL_SCHEME, digest: canonicalDigest(plain) },
  };
}

/** Serialize and self-verify a backup before it is handed to the user. */
export function serializeBackup(file: BackupFile): string {
  const text = JSON.stringify(file, null, 2);
  const check = parseBackup(text);
  if (!check.ok) throw new Error(`backup self-check failed: ${check.error}`);
  return text;
}

export function backupFileName(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `daybook-backup-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(date.getHours())}${p(
    date.getMinutes(),
  )}.json`;
}

export type ParseBackupResult = { ok: true; backup: ParsedBackup; warnings: string[] } | { ok: false; error: string };

/**
 * Strictly validate a backup file. Any invalid record rejects the whole file.
 * Error codes: not_json, not_backup, unsupported_format:<n>, missing_data, missing_integrity,
 * digest_mismatch, checksum_mismatch (legacy), invalid_record:<detail>.
 */
export function parseBackup(text: string): ParseBackupResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    return { ok: false, error: 'not_json' };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || (raw as Record<string, unknown>).app !== BACKUP_APP) {
    return { ok: false, error: 'not_backup' };
  }
  const obj = raw as Record<string, unknown>;
  const format = obj.format;
  if (typeof format !== 'number' || !Number.isInteger(format) || format < OLDEST_SUPPORTED_FORMAT || format > BACKUP_FORMAT) {
    return { ok: false, error: `unsupported_format:${String(format)}` };
  }
  const warnings: string[] = [];

  // 1) Integrity of the file as written, before interpreting any record.
  let integrity: IntegrityLevel;
  if (format >= 2) {
    const integ = obj.integrity as Partial<BackupIntegrity> | undefined;
    if (!integ || integ.algorithm !== 'SHA-256' || integ.scheme !== CANONICAL_SCHEME || typeof integ.digest !== 'string') {
      return { ok: false, error: 'missing_integrity' };
    }
    if (canonicalDigest(withoutIntegrity(obj)) !== integ.digest.toLowerCase()) return { ok: false, error: 'digest_mismatch' };
    integrity = 'sha256';
  } else {
    integrity = 'legacy-summary';
    warnings.push('legacy_format');
  }

  // 2) Structure and every record.
  const data = obj.data as Record<string, unknown> | undefined;
  if (!data || typeof data !== 'object' || !Array.isArray(data.accounts) || !Array.isArray(data.trades) || !Array.isArray(data.cashflows)) {
    return { ok: false, error: 'missing_data' };
  }
  if (data.tombstones !== undefined && !Array.isArray(data.tombstones)) return { ok: false, error: 'missing_data' };
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
  const tombstones: Tombstone[] = [];
  const tombIds = new Set<string>();
  for (let i = 0; i < ((data.tombstones as unknown[]) ?? []).length; i++) {
    const t = (data.tombstones as unknown[])[i] as Partial<Tombstone> | null;
    const okShape =
      t && typeof t === 'object' && typeof t.id === 'string' && t.id &&
      (t.table === 'accounts' || t.table === 'trades' || t.table === 'cashflows') &&
      typeof t.deletedAt === 'number' && Number.isFinite(t.deletedAt) && t.deletedAt > 0;
    if (!okShape) return fail('tombstone', i, ['invalid']);
    // A file can't both contain a record and say it was deleted.
    if (ids.has(t.id!) || tombIds.has(t.id!)) return fail('tombstone', i, ['conflicts with a record']);
    tombIds.add(t.id!);
    tombstones.push({ id: t.id!, table: t.table!, deletedAt: Math.floor(t.deletedAt!) });
  }

  // 3) Summary must agree with the records (the only check v1.0 files have).
  const summary = summarize(accounts, trades, cashflows);
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
  } else if (format >= 2) {
    return { ok: false, error: 'missing_data' };
  } else warnings.push('no_summary');

  const settings = obj.settings as { lang?: unknown } | undefined;
  const lang = settings?.lang === 'en' || settings?.lang === 'zh' ? settings.lang : null;
  return {
    ok: true,
    warnings,
    backup: {
      format,
      exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : null,
      accounts,
      trades,
      cashflows,
      tombstones,
      lang,
      summary,
      integrity,
    },
  };
}

// ---------------------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------------------

export interface RestoreResult {
  mode: 'replace' | 'merge';
  /** records written that did not exist locally */
  added: number;
  /** local records replaced by a newer backup version */
  updated: number;
  /** local records removed because the backup holds a newer deletion */
  deleted: number;
  /** backup records not applied because the local copy differs and is newer (or deleted later) */
  kept: number;
  /** backup records identical to the local copy */
  unchanged: number;
  /** backup records dropped because their account was deleted (and nothing in it changed since) */
  orphaned: number;
  accounts: number;
  trades: number;
  cashflows: number;
  /** Restores the database to exactly its state before this restore. */
  undo: () => Promise<void>;
}

interface Snapshot {
  accounts: Account[];
  trades: Trade[];
  cashflows: CashFlow[];
  tombstones: Tombstone[];
}

type Table = 'accounts' | 'trades' | 'cashflows';

async function readAll(d: DaybookDB): Promise<Snapshot> {
  const [accounts, trades, cashflows, tombstones] = await Promise.all([
    d.accounts.toArray(),
    d.trades.toArray(),
    d.cashflows.toArray(),
    d.tombstones.toArray(),
  ]);
  return { accounts, trades, cashflows, tombstones };
}

const byId = <T extends { id: string }>(xs: T[]) => [...xs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const fingerprint = (s: Snapshot) =>
  canonicalDigest({ a: byId(s.accounts), t: byId(s.trades), c: byId(s.cashflows), x: byId(s.tombstones) });

async function writeAll(d: DaybookDB, s: Snapshot) {
  await Promise.all([d.accounts.clear(), d.trades.clear(), d.cashflows.clear(), d.tombstones.clear()]);
  await d.accounts.bulkPut(s.accounts);
  await d.trades.bulkPut(s.trades);
  await d.cashflows.bulkPut(s.cashflows);
  await d.tombstones.bulkPut(s.tombstones);
}

/** Write a full snapshot and verify, inside the same transaction, that it reads back identically. */
async function writeVerified(d: DaybookDB, s: Snapshot) {
  await writeAll(d, s);
  const back = await readAll(d);
  if (fingerprint(back) !== fingerprint(s)) throw new Error('restore verification failed');
}

type Version<T> = { live: true; rec: T; ts: number } | { live: false; ts: number };

/**
 * Merge conflict rules (last-writer-wins per record id; deletions are timestamped tombstones):
 *  R1  A record present on one side only is added — unless the other side has a tombstone for it
 *      that is at least as new as the record (deleted → stays deleted; ties favour the deletion).
 *  R2  Present on both sides: the copy with the strictly newer updatedAt wins; ties keep local.
 *  R3  A tombstone in the backup deletes a local record only if deletedAt is strictly newer than
 *      the local updatedAt (a later local edit or undo survives an older deletion).
 *  R4  Account cascade: an account deleted on either side stays deleted only if neither the
 *      account nor any trade/transfer in it changed after the deletion; otherwise the account is
 *      kept (newest version) together with its records. Records whose account ends up deleted are
 *      deleted too, so no orphan trade can ever exist.
 *  R5  Tombstones are unioned (newest deletedAt per id) and dropped for ids that end up live.
 *  R6  Settings are never changed by a merge.
 */
export function planMerge(local: Snapshot, incoming: Snapshot) {
  const tombsL = new Map(local.tombstones.map((t) => [t.id, t]));
  const tombsB = new Map(incoming.tombstones.map((t) => [t.id, t]));

  function resolve<T extends { id: string; updatedAt: number }>(table: Table, loc: T[], inc: T[]) {
    const L = new Map<string, Version<T>>();
    const B = new Map<string, Version<T>>();
    for (const r of loc) L.set(r.id, { live: true, rec: r, ts: r.updatedAt });
    for (const r of inc) B.set(r.id, { live: true, rec: r, ts: r.updatedAt });
    for (const t of local.tombstones) if (t.table === table && !L.has(t.id)) L.set(t.id, { live: false, ts: t.deletedAt });
    for (const t of incoming.tombstones) if (t.table === table && !B.has(t.id)) B.set(t.id, { live: false, ts: t.deletedAt });
    const out = new Map<string, { win: Version<T>; local?: Version<T>; incoming?: Version<T> }>();
    for (const id of new Set([...L.keys(), ...B.keys()])) {
      const l = L.get(id);
      const b = B.get(id);
      let win: Version<T>;
      if (!l) win = b!;
      else if (!b) win = l;
      else if (l.live && b.live) win = b.ts > l.ts ? b : l; // R2
      else if (!l.live && !b.live) win = b.ts > l.ts ? b : l;
      else if (l.live) win = b.ts > l.ts ? b : l; // R3: backup deletion vs local record
      else win = b.ts > l.ts ? b : l; // R1: local deletion vs backup record (tie → deletion)
      out.set(id, { win, local: l, incoming: b });
    }
    return out;
  }

  const accounts = resolve('accounts', local.accounts, incoming.accounts);
  const trades = resolve('trades', local.trades, incoming.trades);
  const cashflows = resolve('cashflows', local.cashflows, incoming.cashflows);

  // R4 — account cascade
  const newestChild = new Map<string, number>();
  for (const m of [trades, cashflows])
    for (const { win } of m.values())
      if (win.live) newestChild.set(win.rec.accountId, Math.max(newestChild.get(win.rec.accountId) ?? 0, win.ts));
  for (const [id, entry] of accounts) {
    if (entry.win.live) continue;
    const deletedAt = entry.win.ts;
    if ((newestChild.get(id) ?? 0) > deletedAt) {
      // something in the account changed after it was deleted → keep the newest live version
      const candidates = [entry.local, entry.incoming].filter((v): v is Version<Account> & { live: true } => !!v && v.live);
      candidates.sort((a, b) => b.ts - a.ts);
      if (candidates[0]) entry.win = candidates[0];
    }
  }
  const liveAccounts = new Set([...accounts].filter(([, e]) => e.win.live).map(([id]) => id));
  const orphans = new Set<string>();
  for (const m of [trades, cashflows] as Map<string, { win: Version<Trade | CashFlow>; local?: Version<Trade | CashFlow>; incoming?: Version<Trade | CashFlow> }>[]) {
    for (const [id, entry] of m) {
      if (entry.win.live && !liveAccounts.has(entry.win.rec.accountId)) {
        const acc = accounts.get(entry.win.rec.accountId);
        if (entry.win === entry.incoming && !entry.local?.live) orphans.add(id);
        entry.win = { live: false, ts: Math.max(acc?.win.ts ?? 0, entry.win.ts) };
      }
    }
  }

  // Build final snapshot + stats
  const stats = { added: 0, updated: 0, deleted: 0, kept: 0, unchanged: 0, orphaned: orphans.size };
  const final: Snapshot = { accounts: [], trades: [], cashflows: [], tombstones: [] };
  const tables: [Table, Map<string, { win: Version<{ id: string; updatedAt: number }>; local?: Version<unknown>; incoming?: Version<unknown> }>][] = [
    ['accounts', accounts as never],
    ['trades', trades as never],
    ['cashflows', cashflows as never],
  ];
  for (const [table, m] of tables) {
    for (const [id, { win, local: l, incoming: b }] of m) {
      if (win.live) (final[table] as { id: string }[]).push(win.rec);
      else {
        const ts = Math.max(win.ts, tombsL.get(id)?.deletedAt ?? 0, tombsB.get(id)?.deletedAt ?? 0);
        final.tombstones.push({ id, table, deletedAt: ts });
      }
      const localLive = !!l?.live;
      if (!win.live && localLive) stats.deleted++;
      if (!b || orphans.has(id)) continue;
      if (b.live && l?.live && canonicalJSON(b.rec) === canonicalJSON(l.rec)) stats.unchanged++;
      else if (win.live && !localLive) stats.added++;
      else if (win.live && localLive && win !== l) stats.updated++;
      else if (b.live && win !== b) stats.kept++;
    }
  }
  return { final, stats };
}

/**
 * Restore inside ONE IndexedDB transaction: any failure (including the read-back
 * verification) aborts the transaction and leaves the database exactly as it was.
 */
export async function restoreBackup(
  b: ParsedBackup,
  mode: 'replace' | 'merge',
  d: DaybookDB = defaultDb,
): Promise<RestoreResult> {
  let before!: Snapshot;
  let stats = { added: 0, updated: 0, deleted: 0, kept: 0, unchanged: 0, orphaned: 0 };
  let final!: Snapshot;
  let prevLang: string | null = null;
  await d.transaction('rw', [d.accounts, d.trades, d.cashflows, d.tombstones, d.meta], async () => {
    before = await readAll(d);
    prevLang = (await getSettings(d)).lang;
    const incoming: Snapshot = { accounts: b.accounts, trades: b.trades, cashflows: b.cashflows, tombstones: b.tombstones };
    if (mode === 'replace') {
      final = incoming;
      const localIds = new Set([...before.accounts, ...before.trades, ...before.cashflows].map((r) => r.id));
      stats = {
        added: [...b.accounts, ...b.trades, ...b.cashflows].filter((r) => !localIds.has(r.id)).length,
        updated: 0,
        deleted: 0,
        kept: 0,
        unchanged: 0,
        orphaned: 0,
      };
    } else {
      ({ final, stats } = planMerge(before, incoming));
    }
    await writeVerified(d, final);
    if (mode === 'replace' && b.lang) await saveSettings({ lang: b.lang as 'en' | 'zh' }, d);
  });
  return {
    mode,
    ...stats,
    accounts: final.accounts.length,
    trades: final.trades.length,
    cashflows: final.cashflows.length,
    undo: async () => {
      await d.transaction('rw', [d.accounts, d.trades, d.cashflows, d.tombstones, d.meta], async () => {
        await writeVerified(d, before);
        if (mode === 'replace') await saveSettings({ lang: prevLang as 'en' | 'zh' | null }, d);
      });
    },
  };
}
