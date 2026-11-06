import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { DaybookDB } from '../../src/db/db';
import {
  addCashFlow, addTrade, createAccount, deleteAccount, deleteTrades, eraseAllData, updateTrade, type TradeInput,
} from '../../src/db/actions';
import { buildBackup, parseBackup, restoreBackup } from '../../src/db/backup';
import {
  accountBalance, aggregateByDay, combinedBalance, cumulativeSeries, monthlySeries, summarizeDays, summarizeTrades,
} from '../../src/lib/stats';

let d: DaybookDB;
let n = 0;
beforeEach(async () => {
  d = new DaybookDB(`test-${++n}`);
  await d.open();
});

const T = (accountId: string, date: string, pnlCents: number, extra: Partial<TradeInput> = {}): TradeInput => ({
  accountId, date, pnlCents, feesCents: null, symbol: '', platform: '', tags: [], notes: '', side: null,
  quantity: null, entryPrice: null, exitPrice: null, entryTime: null, exitTime: null, ...extra,
});

async function all() {
  return { accounts: await d.accounts.toArray(), trades: await d.trades.toArray(), cashflows: await d.cashflows.toArray() };
}

async function scenarioA() {
  const A = await createAccount({ name: 'A', startingBalanceCents: 1000_00, startDate: '2026-11-01', color: '#4F8CFF' }, d);
  const B = await createAccount({ name: 'B', startingBalanceCents: 2000_00, startDate: '2026-11-01', color: '#A78BFA' }, d);
  const t1 = await addTrade(T(A.id, '2026-11-03', 200_00, { symbol: 'AAPL' }), d);
  await addTrade(T(A.id, '2026-11-04', -50_00), d);
  await addTrade(T(B.id, '2026-11-04', 20_00), d);
  await addCashFlow({ accountId: A.id, date: '2026-11-05', type: 'deposit', amountCents: 500_00, notes: '' }, d);
  return { A, B, t1 };
}

describe('Scenario A — basic accounting', () => {
  it('computes per-account and combined P&L and balances; deposits are not P&L', async () => {
    const { A, B } = await scenarioA();
    const { accounts, trades, cashflows } = await all();
    const aTrades = trades.filter((t) => t.accountId === A.id);
    const bTrades = trades.filter((t) => t.accountId === B.id);
    expect(summarizeTrades(aTrades).netCents).toBe(150_00);
    expect(summarizeTrades(bTrades).netCents).toBe(20_00);
    const allSum = summarizeTrades(trades);
    expect(allSum.netCents).toBe(170_00);
    expect(allSum.count).toBe(3);
    expect(allSum.wins).toBe(2);
    expect(allSum.losses).toBe(1);
    expect(allSum.winRate).toBeCloseTo(2 / 3);
    expect(combinedBalance(accounts, trades, cashflows).estimatedCents).toBe(3670_00);
    const aBal = accountBalance(A, trades, cashflows);
    expect(aBal.estimatedCents).toBe(1650_00);
    expect(aBal.depositsCents).toBe(500_00);
    expect(aBal.tradingPnlCents).toBe(150_00);
    expect(accountBalance(B, trades, cashflows).estimatedCents).toBe(2020_00);
  });

  it('day statistics are distinct from trade statistics', async () => {
    await scenarioA();
    const { trades } = await all();
    const days = [...aggregateByDay(trades).values()];
    const ds = summarizeDays(days);
    // Nov 3: +200 (green). Nov 4: -50 + 20 = -30 (red)
    expect(ds.tradingDays).toBe(2);
    expect(ds.greenDays).toBe(1);
    expect(ds.redDays).toBe(1);
    expect(ds.greenDayRate).toBe(0.5);
    expect(ds.bestDay?.date).toBe('2026-11-03');
    expect(ds.worstDay?.pnlCents).toBe(-30_00);
    expect(aggregateByDay(trades).get('2026-11-04')?.trades).toBe(2);
  });
});

describe('Scenario B — edits and deletes propagate', () => {
  it('recomputes everything after edit and delete; undo restores', async () => {
    const { A, t1 } = await scenarioA();
    await updateTrade(t1.trade.id, { pnlCents: 300_00 }, d);
    let { accounts, trades, cashflows } = await all();
    expect(summarizeTrades(trades).netCents).toBe(270_00);
    expect(combinedBalance(accounts, trades, cashflows).estimatedCents).toBe(3770_00);
    expect(aggregateByDay(trades).get('2026-11-03')?.pnlCents).toBe(300_00);
    expect(monthlySeries(trades)).toEqual([{ month: '2026-11', pnlCents: 270_00, trades: 3 }]);
    expect(cumulativeSeries(trades).at(-1)?.cumCents).toBe(270_00);

    const undo = await deleteTrades([t1.trade.id], d);
    ({ accounts, trades, cashflows } = await all());
    expect(trades.length).toBe(2);
    expect(summarizeTrades(trades).netCents).toBe(-30_00);
    expect(aggregateByDay(trades).has('2026-11-03')).toBe(false);
    expect(accountBalance(A, trades, cashflows).estimatedCents).toBe(1000_00 + 500_00 - 50_00);
    expect(await d.tombstones.get(t1.trade.id)).toBeTruthy();

    await undo();
    ({ trades } = await all());
    expect(summarizeTrades(trades).netCents).toBe(270_00);
    expect(await d.tombstones.get(t1.trade.id)).toBeUndefined();
  });

  it('deleting an account removes its trades and flows (and undo restores them)', async () => {
    const { A } = await scenarioA();
    const undo = await deleteAccount(A.id, d);
    let { accounts, trades, cashflows } = await all();
    expect(accounts.length).toBe(1);
    expect(trades.length).toBe(1);
    expect(cashflows.length).toBe(0);
    expect(combinedBalance(accounts, trades, cashflows).estimatedCents).toBe(2020_00);
    await undo();
    ({ accounts, trades, cashflows } = await all());
    expect(combinedBalance(accounts, trades, cashflows).estimatedCents).toBe(3670_00);
  });

  it('rejects invalid records', async () => {
    const { A } = await scenarioA();
    await expect(addTrade(T(A.id, '2026-02-30', 100), d)).rejects.toThrow();
    await expect(addTrade(T(A.id, '2026-02-01', 1.5), d)).rejects.toThrow();
    await expect(addTrade(T('nope', '2026-02-01', 100), d)).rejects.toThrow();
    await expect(addCashFlow({ accountId: A.id, date: '2026-11-01', type: 'deposit', amountCents: -5, notes: '' }, d)).rejects.toThrow();
  });
});

describe('Balance start date', () => {
  it('excludes records dated before the balance start date from the estimated balance only', async () => {
    const A = await createAccount({ name: 'A', startingBalanceCents: 1000_00, startDate: '2026-06-01', color: '#4F8CFF' }, d);
    await addTrade(T(A.id, '2026-05-31', 999_00), d);
    await addTrade(T(A.id, '2026-06-01', 10_00), d);
    const { trades, cashflows } = await all();
    const b = accountBalance(A, trades, cashflows);
    expect(b.estimatedCents).toBe(1010_00);
    expect(b.excludedTrades).toBe(1);
    expect(summarizeTrades(trades).netCents).toBe(1009_00);
  });
});

describe('Streaks', () => {
  it('counts consecutive trading days, skipping non-trading days', () => {
    const mk = (date: string, pnlCents: number) => ({ date, pnlCents, trades: 1, wins: 0, losses: 0 });
    const s = summarizeDays([
      mk('2026-01-02', 10), mk('2026-01-05', 10), mk('2026-01-06', 10), // 3 green (weekend skipped)
      mk('2026-01-07', -5), mk('2026-01-08', -5),
      mk('2026-01-09', 0),
      mk('2026-01-12', -1),
    ]);
    expect(s.longestWinStreak).toBe(3);
    expect(s.longestLossStreak).toBe(2);
    expect(s.currentStreak).toBe(-1);
    expect(s.flatDays).toBe(1);
  });
});

describe('Scenario C — backup and restore', () => {
  it('export → wipe → restore yields identical data and statistics', async () => {
    await scenarioA();
    const before = await all();
    const file = await buildBackup(d);
    const text = JSON.stringify(file);
    await eraseAllData(d);
    expect((await all()).trades.length).toBe(0);

    const parsed = parseBackup(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    await restoreBackup(parsed.backup, 'replace', d);
    const after = await all();
    const byId = <T extends { id: string }>(xs: T[]) => [...xs].sort((a, b) => a.id.localeCompare(b.id));
    expect(byId(after.accounts)).toEqual(byId(before.accounts));
    expect(byId(after.trades)).toEqual(byId(before.trades));
    expect(byId(after.cashflows)).toEqual(byId(before.cashflows));
    expect(combinedBalance(after.accounts, after.trades, after.cashflows).estimatedCents).toBe(3670_00);
    expect(summarizeTrades(after.trades).netCents).toBe(170_00);
  });

  it('merge restore never duplicates records', async () => {
    await scenarioA();
    const text = JSON.stringify(await buildBackup(d));
    const parsed = parseBackup(text);
    if (!parsed.ok) throw new Error('parse');
    await restoreBackup(parsed.backup, 'merge', d);
    await restoreBackup(parsed.backup, 'merge', d);
    const { trades, cashflows, accounts } = await all();
    expect(trades.length).toBe(3);
    expect(cashflows.length).toBe(1);
    expect(accounts.length).toBe(2);
  });

  it('rejects tampered, foreign or malformed backups', async () => {
    await scenarioA();
    const file = await buildBackup(d);
    expect(parseBackup('not json').ok).toBe(false);
    expect(parseBackup(JSON.stringify({ hello: 1 })).ok).toBe(false);
    const tampered = structuredClone(file);
    tampered.data.trades[0].pnlCents += 1;
    const r1 = parseBackup(JSON.stringify(tampered));
    expect(r1.ok === false && r1.error).toBe('digest_mismatch');
    const bad = structuredClone(file);
    (bad.data.trades[0] as unknown as Record<string, unknown>).date = '2026-02-31';
    expect(parseBackup(JSON.stringify(bad)).ok).toBe(false);
    const orphan = structuredClone(file);
    orphan.data.trades[0].accountId = 'missing';
    expect(parseBackup(JSON.stringify(orphan)).ok).toBe(false);
    const future = { ...structuredClone(file), format: 99 };
    expect(parseBackup(JSON.stringify(future)).ok).toBe(false);
  });
});
