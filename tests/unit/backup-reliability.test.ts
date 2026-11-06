import 'fake-indexeddb/auto';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DaybookDB } from '../../src/db/db';
import {
  addCashFlow, addTrade, createAccount, deleteAccount, deleteTrades, updateTrade, type TradeInput,
} from '../../src/db/actions';
import { buildBackup, parseBackup, restoreBackup, serializeBackup, UndoConflictError, type ParsedBackup } from '../../src/db/backup';
import { canonicalDigest, canonicalJSON, sha256Hex } from '../../src/lib/digest';
import { accountBalance, combinedBalance, summarizeTrades } from '../../src/lib/stats';
import { buildImportPreview, exportCSV, guessMapping, parseCSV } from '../../src/lib/csv';
import { commitImport } from '../../src/db/importCsv';

let n = 0;
const freshDb = async () => {
  const d = new DaybookDB(`rel-${++n}-${Math.random()}`);
  await d.open();
  return d;
};
const T = (accountId: string, date: string, pnlCents: number, extra: Partial<TradeInput> = {}): TradeInput => ({
  accountId, date, pnlCents, feesCents: null, symbol: '', platform: '', tags: [], notes: '', side: null,
  quantity: null, entryPrice: null, exitPrice: null, entryTime: null, exitTime: null, ...extra,
});
const snapshot = async (d: DaybookDB) => {
  const sort = <X extends { id: string }>(xs: X[]) => xs.sort((a, b) => a.id.localeCompare(b.id));
  return {
    accounts: sort(await d.accounts.toArray()),
    trades: sort(await d.trades.toArray()),
    cashflows: sort(await d.cashflows.toArray()),
    tombstones: sort(await d.tombstones.toArray()),
  };
};
const parse = (text: string): ParsedBackup => {
  const r = parseBackup(text);
  if (!r.ok) throw new Error(r.error);
  return r.backup;
};
const exportText = async (d: DaybookDB) => serializeBackup(await buildBackup(d));
/** Advance the clock so updatedAt/deletedAt ordering in tests is unambiguous. */
let clock = Date.UTC(2026, 10, 1);
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(clock);
});
const tick = (ms = 1000) => {
  clock += ms;
  vi.setSystemTime(clock);
};
async function noOrphans(d: DaybookDB) {
  const ids = new Set((await d.accounts.toArray()).map((a) => a.id));
  for (const t of await d.trades.toArray()) expect(ids.has(t.accountId), `orphan trade ${t.id}`).toBe(true);
  for (const c of await d.cashflows.toArray()) expect(ids.has(c.accountId), `orphan flow ${c.id}`).toBe(true);
}

// ------------------------------------------------------------------------------------------

describe('SHA-256 and canonical JSON', () => {
  it('matches Node crypto on known vectors and block boundaries', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    for (const len of [1, 55, 56, 57, 63, 64, 65, 119, 120, 1000, 100_000]) {
      const s = Array.from({ length: len }, (_, i) => String.fromCharCode(32 + ((i * 7919) % 90))).join('') + '盈亏€😀';
      expect(sha256Hex(s), `len ${len}`).toBe(createHash('sha256').update(s, 'utf8').digest('hex'));
    }
  });
  it('is independent of key order and whitespace, sensitive to values and array order', () => {
    expect(canonicalJSON({ b: 1, a: { d: [1, 2], c: 'x' } })).toBe('{"a":{"c":"x","d":[1,2]},"b":1}');
    expect(canonicalDigest({ a: 1, b: 2 })).toBe(canonicalDigest(JSON.parse('{ "b": 2,\n "a": 1 }')));
    expect(canonicalDigest({ a: [1, 2] })).not.toBe(canonicalDigest({ a: [2, 1] }));
    expect(canonicalDigest({ a: 1 })).not.toBe(canonicalDigest({ a: '1' }));
    expect(canonicalDigest({ a: null })).not.toBe(canonicalDigest({}));
  });
});

describe('Backup integrity (format 2)', () => {
  async function richDb() {
    const d = await freshDb();
    const A = await createAccount({ name: 'Stocks', startingBalanceCents: 1000_00, startDate: '2026-01-01', color: '#4F8CFF' }, d);
    await addTrade(T(A.id, '2026-02-03', 200_01, { symbol: 'AAPL', tags: ['x'], feesCents: 125, notes: 'n', entryTime: '09:30' }), d);
    const gone = await addTrade(T(A.id, '2026-02-04', -5_00), d);
    await deleteTrades([gone.trade.id], d);
    await addCashFlow({ accountId: A.id, date: '2026-02-05', type: 'deposit', amountCents: 10_00, notes: 'dep' }, d);
    return d;
  }

  it('round-trips and reports SHA-256 verification', async () => {
    const d = await richDb();
    const text = await exportText(d);
    const r = parseBackup(text);
    expect(r.ok && r.backup.integrity).toBe('sha256');
    expect(JSON.parse(text).integrity).toMatchObject({ algorithm: 'SHA-256', scheme: 'daybook-canonical-json-v1' });
    // pretty-printing differences are not corruption
    expect(parseBackup(JSON.stringify(JSON.parse(text))).ok).toBe(true);
    expect(parseBackup('﻿' + text).ok).toBe(true);
  });

  it('detects a change to ANY field of ANY record, settings or metadata', async () => {
    const d = await richDb();
    const file = JSON.parse(await exportText(d));
    const paths: (string | number)[][] = [];
    const walk = (v: unknown, path: (string | number)[]) => {
      if (path[0] === 'integrity') return;
      if (v !== null && typeof v === 'object') {
        for (const [k, c] of Object.entries(v as Record<string, unknown>)) walk(c, [...path, Array.isArray(v) ? Number(k) : k]);
      } else paths.push(path);
    };
    walk(file, []);
    expect(paths.length).toBeGreaterThan(40);
    for (const p of paths) {
      const f = structuredClone(file);
      let o = f;
      for (const k of p.slice(0, -1)) o = o[k];
      const last = p[p.length - 1];
      const v = o[last];
      o[last] = typeof v === 'number' ? v + 1 : typeof v === 'boolean' ? !v : v === null ? 'x' : `${v}~`;
      const r = parseBackup(JSON.stringify(f));
      expect(r.ok, `undetected change at ${p.join('.')}`).toBe(false);
    }
    // deleting or reordering records is detected too
    const del = structuredClone(file);
    del.data.tombstones = [];
    expect(parseBackup(JSON.stringify(del))).toEqual({ ok: false, error: 'digest_mismatch' });
    const extra = structuredClone(file);
    extra.data.accounts[0].unknownField = 1;
    expect(parseBackup(JSON.stringify(extra))).toEqual({ ok: false, error: 'digest_mismatch' });
  });

  it('rejects truncated, foreign, future and digest-less files', async () => {
    const d = await richDb();
    const text = await exportText(d);
    expect(parseBackup(text.slice(0, text.length / 2))).toEqual({ ok: false, error: 'not_json' });
    expect(parseBackup('[]')).toEqual({ ok: false, error: 'not_backup' });
    expect(parseBackup('null')).toEqual({ ok: false, error: 'not_backup' });
    const f = JSON.parse(text);
    expect(parseBackup(JSON.stringify({ ...f, format: 3 })).ok).toBe(false);
    expect(parseBackup(JSON.stringify({ ...f, format: '2' })).ok).toBe(false);
    expect(parseBackup(JSON.stringify({ ...f, format: 0 })).ok).toBe(false);
    const { integrity: _i, ...noInt } = f;
    expect(parseBackup(JSON.stringify(noInt))).toEqual({ ok: false, error: 'missing_integrity' });
  });

  it('a recomputed digest is accepted — the checksum is NOT authentication (documented limitation)', async () => {
    const d = await richDb();
    const f = JSON.parse(await exportText(d));
    f.data.trades[0].pnlCents = 999_999_00;
    f.summary.netPnlCents = 999_999_00;
    const { integrity: _i, ...rest } = f;
    f.integrity.digest = canonicalDigest(rest);
    expect(parseBackup(JSON.stringify(f)).ok).toBe(true);
  });

  it('rejects a file that both contains a record and a tombstone for it', async () => {
    const d = await richDb();
    const f = JSON.parse(await exportText(d));
    f.data.tombstones.push({ id: f.data.trades[0].id, table: 'trades', deletedAt: 1 });
    const { integrity: _i, ...rest } = f;
    f.integrity.digest = canonicalDigest(rest);
    const r = parseBackup(JSON.stringify(f));
    expect(r.ok === false && r.error).toMatch(/^invalid_record:tombstone/);
  });

  it('rejects out-of-range and non-integer money even with a valid digest', async () => {
    const d = await richDb();
    for (const bad of [1.5, 1e20, Number.MAX_SAFE_INTEGER, '100', null]) {
      const f = JSON.parse(await exportText(d));
      f.data.trades[0].pnlCents = bad;
      f.summary.netPnlCents = typeof bad === 'number' ? bad : 0;
      const { integrity: _i, ...rest } = f;
      f.integrity.digest = canonicalDigest(rest);
      const r = parseBackup(JSON.stringify(f));
      expect(r.ok, `pnlCents=${bad}`).toBe(false);
    }
  });
});

describe('v1.0 backup compatibility (real v1.0 export fixture)', () => {
  const v1 = readFileSync('tests/fixtures/backup-v1.0.json', 'utf8');

  it('parses with the legacy check and restores exactly', async () => {
    const r = parseBackup(v1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.backup.format).toBe(1);
    expect(r.backup.integrity).toBe('legacy-summary');
    expect(r.warnings).toContain('legacy_format');
    expect(r.backup.summary).toEqual({ accounts: 2, trades: 3, cashflows: 2, netPnlCents: 14903 });
    expect(r.backup.tombstones).toHaveLength(1);
    const d = await freshDb();
    await restoreBackup(r.backup, 'replace', d);
    const s = await snapshot(d);
    const raw = JSON.parse(v1).data;
    const sort = <X extends { id: string }>(xs: X[]) => [...xs].sort((a, b) => a.id.localeCompare(b.id));
    expect(s.accounts).toEqual(sort(raw.accounts));
    expect(s.trades).toEqual(sort(raw.trades));
    expect(s.cashflows).toEqual(sort(raw.cashflows));
    expect(summarizeTrades(s.trades).netCents).toBe(14903);
    const stocks = s.accounts.find((a) => a.name === 'Stocks')!;
    // 1000.00 + 500 deposit + 200.01 − 50.99 = 1649.02
    expect(accountBalance(stocks, s.trades, s.cashflows).estimatedCents).toBe(1649_02);
    const kalshi = s.accounts.find((a) => a.name === 'Kalshi 预测')!;
    // −12.34 − 10.00 withdrawal + 0.01
    expect(accountBalance(kalshi, s.trades, s.cashflows).estimatedCents).toBe(-22_33);
    // re-export from v1.1 upgrades the file to format 2 with a digest
    const again = parseBackup(await exportText(d));
    expect(again.ok && again.backup.format).toBe(2);
    expect(again.ok && again.backup.integrity).toBe('sha256');
  });

  it('still catches count/total changes in v1.0 files (but, honestly, not other field edits)', () => {
    const f = JSON.parse(v1);
    f.data.trades[0].pnlCents += 1;
    expect(parseBackup(JSON.stringify(f))).toEqual({ ok: false, error: 'checksum_mismatch' });
    const g = JSON.parse(v1);
    g.data.trades[0].symbol = 'EDITED';
    const r = parseBackup(JSON.stringify(g));
    expect(r.ok && r.backup.integrity).toBe('legacy-summary'); // weaker guarantee is surfaced in the UI
  });

  it('merging a v1.0 backup into a v1.1 database twice is idempotent', async () => {
    const d = await freshDb();
    const b = parse(v1);
    const r1 = await restoreBackup(b, 'merge', d);
    expect(r1).toMatchObject({ added: 7, updated: 0, deleted: 0 });
    const s1 = await snapshot(d);
    const r2 = await restoreBackup(b, 'merge', d);
    expect(r2).toMatchObject({ added: 0, updated: 0, deleted: 0, kept: 0, unchanged: 7 });
    expect(await snapshot(d)).toEqual(s1);
  });
});

describe('Atomic restore', () => {
  async function seeded() {
    const d = await freshDb();
    const A = await createAccount({ name: 'Local', startingBalanceCents: 5_00, startDate: '2026-01-01', color: '#4F8CFF' }, d);
    await addTrade(T(A.id, '2026-01-02', 7_77), d);
    return d;
  }
  async function otherBackup() {
    const o = await freshDb();
    const B = await createAccount({ name: 'Other', startingBalanceCents: 0, startDate: '2026-01-01', color: '#4F8CFF' }, o);
    for (let i = 0; i < 20; i++) await addTrade(T(B.id, '2026-03-01', i + 1), o);
    return parse(await exportText(o));
  }

  for (const mode of ['replace', 'merge'] as const) {
    it(`${mode}: a write failure midway leaves the database untouched`, async () => {
      const d = await seeded();
      const before = await snapshot(d);
      const b = await otherBackup();
      const spy = vi.spyOn(d.trades, 'bulkPut').mockImplementation((() => Promise.reject(new Error('disk full'))) as never);
      await expect(restoreBackup(b, mode, d)).rejects.toThrow('disk full');
      spy.mockRestore();
      expect(await snapshot(d)).toEqual(before);
    });

    it(`${mode}: a read-back mismatch aborts and rolls back`, async () => {
      const d = await seeded();
      const before = await snapshot(d);
      const b = await otherBackup();
      const real = d.trades.bulkPut.bind(d.trades);
      // silently drop one record, as a faulty storage layer might
      const spy = vi.spyOn(d.trades, 'bulkPut').mockImplementation(((rows: unknown[]) => real(rows.slice(1) as never)) as never);
      await expect(restoreBackup(b, mode, d)).rejects.toThrow('restore verification failed');
      spy.mockRestore();
      expect(await snapshot(d)).toEqual(before);
    });
  }

  it('undo after a replace restores the exact previous database', async () => {
    const d = await seeded();
    const before = await snapshot(d);
    const r = await restoreBackup(await otherBackup(), 'replace', d);
    expect((await snapshot(d)).trades).toHaveLength(20);
    await r.undo();
    expect(await snapshot(d)).toEqual(before);
  });
});

describe('Merge conflict rules', () => {
  /** Two devices that start from the same data. */
  async function twin() {
    const x = await freshDb();
    const A = await createAccount({ name: 'A', startingBalanceCents: 1000_00, startDate: '2026-01-01', color: '#4F8CFF' }, x);
    const t1 = (await addTrade(T(A.id, '2026-02-01', 100_00, { symbol: 'T1' }), x)).trade;
    const t2 = (await addTrade(T(A.id, '2026-02-02', -20_00, { symbol: 'T2' }), x)).trade;
    tick();
    const y = await freshDb();
    await restoreBackup(parse(await exportText(x)), 'replace', y);
    return { x, y, A, t1, t2 };
  }

  it('R1: a trade deleted locally is NOT resurrected by an older backup (also on equal timestamps)', async () => {
    const { x, t1 } = await twin();
    const old = parse(await exportText(x));
    tick();
    await deleteTrades([t1.id], x);
    const r = await restoreBackup(old, 'merge', x);
    expect(await x.trades.get(t1.id)).toBeUndefined();
    expect(r.added).toBe(0);
    // tie: deletion at the same millisecond as the record's last update → stays deleted
    const { x: x2, t2 } = await twin();
    const b2 = parse(await exportText(x2));
    vi.setSystemTime(t2.updatedAt);
    await deleteTrades([t2.id], x2);
    await restoreBackup(b2, 'merge', x2);
    expect(await x2.trades.get(t2.id)).toBeUndefined();
  });

  it('R1: a record edited elsewhere AFTER the local deletion comes back (newest change wins)', async () => {
    const { x, y, t1 } = await twin();
    await deleteTrades([t1.id], x);
    tick();
    await updateTrade(t1.id, { pnlCents: 150_00 }, y);
    await restoreBackup(parse(await exportText(y)), 'merge', x);
    expect((await x.trades.get(t1.id))?.pnlCents).toBe(150_00);
    expect(await x.tombstones.get(t1.id)).toBeUndefined();
  });

  it('R2: newer copy wins in either direction; equal timestamps keep local', async () => {
    const { x, y, t1, t2 } = await twin();
    await updateTrade(t1.id, { pnlCents: 111_00 }, y); // y newer for t1
    tick();
    await updateTrade(t2.id, { pnlCents: -22_00 }, x); // x newer for t2
    const r = await restoreBackup(parse(await exportText(y)), 'merge', x);
    expect((await x.trades.get(t1.id))?.pnlCents).toBe(111_00);
    expect((await x.trades.get(t2.id))?.pnlCents).toBe(-22_00);
    expect(r).toMatchObject({ updated: 1, kept: 1, unchanged: 1 });
    // tie
    const { x: a, y: b, t1: s1 } = await twin();
    await updateTrade(s1.id, { notes: 'a' }, a);
    await updateTrade(s1.id, { notes: 'b' }, b); // same fake millisecond
    await restoreBackup(parse(await exportText(b)), 'merge', a);
    expect((await a.trades.get(s1.id))?.notes).toBe('a');
  });

  it('R3: a newer deletion in the backup removes the local record; an older one does not', async () => {
    const { x, y, t1, t2 } = await twin();
    await deleteTrades([t1.id], y); // deleted at clock
    tick();
    await updateTrade(t2.id, { notes: 'edited after' }, x);
    await deleteTrades([t2.id], y); // y deletes t2 at same time as x's edit → x's edit is not older
    const r = await restoreBackup(parse(await exportText(y)), 'merge', x);
    expect(await x.trades.get(t1.id)).toBeUndefined();
    expect(await x.tombstones.get(t1.id)).toBeTruthy();
    expect(await x.trades.get(t2.id)).toBeTruthy();
    expect(r.deleted).toBe(1);
  });

  it('R3: undoing a delete survives merging a backup taken before the undo', async () => {
    const { x, t1 } = await twin();
    tick();
    const undo = await deleteTrades([t1.id], x);
    const withTomb = parse(await exportText(x));
    tick();
    await undo();
    await restoreBackup(withTomb, 'merge', x);
    expect(await x.trades.get(t1.id)).toBeTruthy();
  });

  it('R4: deleting an account elsewhere removes it and its trades here — no orphans', async () => {
    const { x, y, A } = await twin();
    tick();
    await deleteAccount(A.id, y);
    // a local-only trade added BEFORE that deletion (never seen by y)
    vi.setSystemTime(clock - 500);
    const local = (await addTrade(T(A.id, '2026-02-05', 5_00), x)).trade;
    vi.setSystemTime(clock);
    const r = await restoreBackup(parse(await exportText(y)), 'merge', x);
    expect(await x.accounts.get(A.id)).toBeUndefined();
    expect(await x.trades.get(local.id)).toBeUndefined();
    expect(await x.trades.count()).toBe(0);
    expect(r.deleted).toBe(4); // account + 3 trades
    await noOrphans(x);
  });

  it('R4: an account deleted elsewhere is kept if something in it changed here afterwards', async () => {
    const { x, y, A, t1, t2 } = await twin();
    await deleteAccount(A.id, y);
    tick();
    const fresh = (await addTrade(T(A.id, '2026-03-01', 42_00), x)).trade;
    await restoreBackup(parse(await exportText(y)), 'merge', x);
    expect(await x.accounts.get(A.id)).toBeTruthy();
    expect(await x.trades.get(fresh.id)).toBeTruthy();
    // the older trades were deleted with the account on y and nothing changed them since
    expect(await x.trades.get(t1.id)).toBeUndefined();
    expect(await x.trades.get(t2.id)).toBeUndefined();
    await noOrphans(x);
  });

  it('R4: merging a backup into a device where that account was deleted creates no orphans', async () => {
    const { x, y, A } = await twin();
    // y adds a trade before x deletes the account
    const yNew = (await addTrade(T(A.id, '2026-02-09', 9_00), y)).trade;
    tick();
    await deleteAccount(A.id, x);
    const r = await restoreBackup(parse(await exportText(y)), 'merge', x);
    expect(await x.accounts.get(A.id)).toBeUndefined();
    expect(await x.trades.get(yNew.id)).toBeUndefined();
    expect(r.orphaned).toBe(1);
    await noOrphans(x);
  });

  it('two devices that diverge converge to identical data after merging both ways', async () => {
    const { x, y, A, t1, t2 } = await twin();
    const t3 = (await addTrade(T(A.id, '2026-02-03', 3_00), x)).trade;
    await updateTrade(t1.id, { pnlCents: 101_00 }, x);
    tick();
    await deleteTrades([t2.id], y);
    await addTrade(T(A.id, '2026-02-04', -4_00), y);
    await addCashFlow({ accountId: A.id, date: '2026-02-05', type: 'withdrawal', amountCents: 50_00, notes: '' }, y);
    tick();
    const bx = parse(await exportText(x));
    const by = parse(await exportText(y));
    await restoreBackup(by, 'merge', x);
    await restoreBackup(bx, 'merge', y);
    const sx = await snapshot(x);
    const sy = await snapshot(y);
    expect(sx.accounts).toEqual(sy.accounts);
    expect(sx.trades).toEqual(sy.trades);
    expect(sx.cashflows).toEqual(sy.cashflows);
    expect(sx.trades.map((t) => t.id)).toContain(t3.id);
    expect(sx.trades.map((t) => t.id)).not.toContain(t2.id);
    expect(summarizeTrades(sx.trades).netCents).toBe(101_00 + 3_00 - 4_00);
    expect(combinedBalance(sx.accounts, sx.trades, sx.cashflows).estimatedCents).toBe(1000_00 + 100_00 - 50_00);
  });
});

describe('Money precision and balance boundaries', () => {
  it('10,000 one-cent trades sum exactly and survive backup/restore', async () => {
    const d = await freshDb();
    const A = await createAccount({ name: 'A', startingBalanceCents: 0, startDate: '2026-01-01', color: '#4F8CFF' }, d);
    const now = Date.now();
    await d.trades.bulkAdd(
      Array.from({ length: 10_000 }, (_, i) => ({ ...T(A.id, '2026-01-01', i % 2 ? 1 : 10), id: `t${i}`, createdAt: now, updatedAt: now })),
    );
    const e = await freshDb();
    await restoreBackup(parse(await exportText(d)), 'replace', e);
    const trades = await e.trades.toArray();
    expect(summarizeTrades(trades).netCents).toBe(5_000 * 1 + 5_000 * 10);
    expect(accountBalance((await e.accounts.toArray())[0], trades, []).estimatedCents).toBe(55_000);
  });

  it('balance start date: same day counts, previous day does not; negative balances are allowed', async () => {
    const d = await freshDb();
    const A = await createAccount({ name: 'A', startingBalanceCents: -100_00, startDate: '2026-03-01', color: '#4F8CFF' }, d);
    await addTrade(T(A.id, '2026-02-28', 1_000_00), d);
    await addTrade(T(A.id, '2026-03-01', 1), d);
    await addCashFlow({ accountId: A.id, date: '2026-03-01', type: 'withdrawal', amountCents: 500_00, notes: '' }, d);
    await addCashFlow({ accountId: A.id, date: '2026-02-28', type: 'deposit', amountCents: 9_999_00, notes: '' }, d);
    const b = accountBalance(A, await d.trades.toArray(), await d.cashflows.toArray());
    expect(b.estimatedCents).toBe(-100_00 + 1 - 500_00);
    expect(b.excludedTrades).toBe(1);
  });

  it('largest allowed amounts sum safely', async () => {
    const d = await freshDb();
    const A = await createAccount({ name: 'A', startingBalanceCents: 99_999_999_999_99, startDate: '2026-01-01', color: '#4F8CFF' }, d);
    for (let i = 0; i < 50; i++) await addTrade(T(A.id, '2026-01-02', 99_999_999_999_99), d);
    const total = accountBalance(A, await d.trades.toArray(), []).estimatedCents;
    expect(Number.isSafeInteger(total)).toBe(true);
    expect(total).toBe(51 * 99_999_999_999_99);
    await expect(addTrade(T(A.id, '2026-01-02', 99_999_999_999_99 + 1), d)).rejects.toThrow();
  });
});

describe('CSV re-import after deletion', () => {
  it('never reuses a deleted record id, and re-importing does not double count', async () => {
    const d = await freshDb();
    const A = await createAccount({ name: 'A', startingBalanceCents: 0, startDate: '2026-01-01', color: '#4F8CFF' }, d);
    const t = (await addTrade(T(A.id, '2026-01-05', 12_34, { symbol: 'X' }), d)).trade;
    const csv = exportCSV(await d.accounts.toArray(), await d.trades.toArray(), []);
    await deleteTrades([t.id], d);
    const table = parseCSV(csv);
    const existing = { accounts: await d.accounts.toArray(), trades: await d.trades.toArray(), cashflows: [] };
    const p = buildImportPreview(table, guessMapping(table[0]), { dateOrder: 'auto', defaultAccountId: null, unknownAccounts: 'create', pnlIsGross: false, includeDuplicates: false }, existing);
    expect(p.counts.ok).toBe(1);
    const res = await commitImport(p, false, d);
    expect(res.tradeIds[0]).not.toBe(t.id);
    expect(await d.tombstones.get(t.id)).toBeTruthy();
    expect(summarizeTrades(await d.trades.toArray()).netCents).toBe(12_34);
  });
});

describe('Undo safety: an undo never overwrites changes made after the operation', () => {
  async function restored(mode: 'replace' | 'merge') {
    const d = await freshDb();
    const L = await createAccount({ name: 'Local', startingBalanceCents: 1_00, startDate: '2026-01-01', color: '#4F8CFF' }, d);
    const localTrade = (await addTrade(T(L.id, '2026-01-02', 2_00), d)).trade;
    const o = await freshDb();
    const B = await createAccount({ name: 'Backup', startingBalanceCents: 0, startDate: '2026-01-01', color: '#4F8CFF' }, o);
    await addTrade(T(B.id, '2026-02-01', 3_00), o);
    tick();
    const r = await restoreBackup(parse(await exportText(o)), mode, d);
    tick();
    const trades = await d.trades.toArray();
    const accounts = await d.accounts.toArray();
    return { d, r, trades, accounts, localTrade };
  }

  type Ctx = Awaited<ReturnType<typeof restored>>;
  const changes: [string, (c: Ctx) => Promise<unknown>][] = [
    ['a new trade', (c) => addTrade(T(c.accounts[0].id, '2026-03-01', 9_99), c.d)],
    ['an edited trade', (c) => updateTrade(c.trades[0].id, { pnlCents: -1 }, c.d)],
    ['a deleted trade', (c) => deleteTrades([c.trades[0].id], c.d)],
    ['a new transfer', (c) => addCashFlow({ accountId: c.accounts[0].id, date: '2026-03-02', type: 'deposit', amountCents: 5_00, notes: '' }, c.d)],
    ['an edited account', (c) => import('../../src/db/actions').then((m) => m.updateAccount(c.accounts[0].id, { name: 'Renamed' }, c.d))],
    ['a deleted account', (c) => deleteAccount(c.accounts[0].id, c.d)],
  ];

  for (const mode of ['replace', 'merge'] as const) {
    for (const [what, change] of changes) {
      it(`${mode}: undo is refused after ${what}, and all current data is kept`, async () => {
        const c = await restored(mode);
        await change(c);
        const current = await snapshot(c.d);
        await expect(c.r.undo()).rejects.toBeInstanceOf(UndoConflictError);
        expect(await snapshot(c.d)).toEqual(current);
      });
    }

    it(`${mode}: undo still works when nothing changed, and only once`, async () => {
      const d = await freshDb();
      const A = await createAccount({ name: 'A', startingBalanceCents: 0, startDate: '2026-01-01', color: '#4F8CFF' }, d);
      await addTrade(T(A.id, '2026-01-02', 1_00), d);
      const before = await snapshot(d);
      const o = await freshDb();
      const B = await createAccount({ name: 'B', startingBalanceCents: 0, startDate: '2026-01-01', color: '#4F8CFF' }, o);
      await addTrade(T(B.id, '2026-01-03', 2_00), o);
      const r = await restoreBackup(parse(await exportText(o)), mode, d);
      await r.undo();
      expect(await snapshot(d)).toEqual(before);
      // a second undo would no longer match the post-restore state → refused, no change
      await expect(r.undo()).rejects.toBeInstanceOf(UndoConflictError);
      expect(await snapshot(d)).toEqual(before);
    });
  }

  it('CSV import undo is refused if an imported trade was edited/deleted or something was added to a created account', async () => {
    const setup = async () => {
      const d = await freshDb();
      const table = parseCSV('date,account,symbol,pnl\n2026-01-05,NewAcc,AAA,10\n2026-01-06,NewAcc,BBB,-4');
      const p = buildImportPreview(table, guessMapping(table[0]), { dateOrder: 'auto', defaultAccountId: null, unknownAccounts: 'create', pnlIsGross: false, includeDuplicates: false }, { accounts: [], trades: [], cashflows: [] });
      const res = await commitImport(p, false, d);
      tick();
      return { d, res };
    };
    const { undoImport } = await import('../../src/db/importCsv');
    // untouched → undo removes exactly the import
    const a = await setup();
    await undoImport(a.res, a.d);
    expect(await a.d.trades.count()).toBe(0);
    expect(await a.d.accounts.count()).toBe(0);
    // edited
    const b = await setup();
    await updateTrade(b.res.tradeIds[0], { notes: 'edited' }, b.d);
    const sb = await snapshot(b.d);
    await expect(undoImport(b.res, b.d)).rejects.toBeInstanceOf(UndoConflictError);
    expect(await snapshot(b.d)).toEqual(sb);
    // deleted
    const c = await setup();
    await deleteTrades([c.res.tradeIds[0]], c.d);
    const sc = await snapshot(c.d);
    await expect(undoImport(c.res, c.d)).rejects.toBeInstanceOf(UndoConflictError);
    expect(await snapshot(c.d)).toEqual(sc);
    // a manual trade added to the account the import created
    const e = await setup();
    await addTrade(T(e.res.accountIds[0], '2026-01-07', 1), e.d);
    const se = await snapshot(e.d);
    await expect(undoImport(e.res, e.d)).rejects.toBeInstanceOf(UndoConflictError);
    expect(await snapshot(e.d)).toEqual(se);
  });
});
