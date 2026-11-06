import { db as defaultDb, type DaybookDB } from './db';
import { newId, type Account, type CashFlow, type Settings, type Trade } from './types';
import { normalizeAccount, normalizeCashFlow, normalizeTrade } from './validate';

/**
 * All writes go through these functions. Each mutating function returns an `undo`
 * callback that restores the exact previous state, used by the Undo toast.
 */
export type Undo = () => Promise<void>;

export type TradeInput = Omit<Trade, 'id' | 'createdAt' | 'updatedAt'>;
export type CashFlowInput = Omit<CashFlow, 'id' | 'createdAt' | 'updatedAt'>;
export type AccountInput = Omit<Account, 'id' | 'createdAt' | 'updatedAt' | 'sortOrder' | 'archived'> &
  Partial<Pick<Account, 'archived' | 'sortOrder'>>;

function assertOk<T>(r: { ok: true; value: T } | { ok: false; errors: string[] }): T {
  if (!r.ok) throw new Error(`Invalid record: ${r.errors.join(', ')}`);
  return r.value;
}

async function tomb(d: DaybookDB, table: 'accounts' | 'trades' | 'cashflows', ids: string[]) {
  const now = Date.now();
  await d.tombstones.bulkPut(ids.map((id) => ({ id, table, deletedAt: now })));
}

async function untomb(d: DaybookDB, ids: string[]) {
  await d.tombstones.bulkDelete(ids);
}

// ---------- Accounts ----------

export async function createAccount(input: AccountInput, d: DaybookDB = defaultDb): Promise<Account> {
  const now = Date.now();
  const count = await d.accounts.count();
  const acc = assertOk(
    normalizeAccount({ ...input, id: newId(), archived: false, sortOrder: input.sortOrder ?? count, createdAt: now, updatedAt: now }),
  );
  await d.accounts.add(acc);
  return acc;
}

export async function updateAccount(id: string, patch: Partial<AccountInput>, d: DaybookDB = defaultDb): Promise<Undo> {
  const prev = await d.accounts.get(id);
  if (!prev) throw new Error('Account not found');
  const next = assertOk(normalizeAccount({ ...prev, ...patch, id, updatedAt: Date.now() }));
  await d.accounts.put(next);
  return async () => {
    await d.accounts.put(prev);
  };
}

/** Deletes an account together with all of its trades and cash flows. */
export async function deleteAccount(id: string, d: DaybookDB = defaultDb): Promise<Undo> {
  let acc: Account | undefined;
  let trades: Trade[] = [];
  let flows: CashFlow[] = [];
  await d.transaction('rw', [d.accounts, d.trades, d.cashflows, d.tombstones], async () => {
    acc = await d.accounts.get(id);
    if (!acc) throw new Error('Account not found');
    trades = await d.trades.where('accountId').equals(id).toArray();
    flows = await d.cashflows.where('accountId').equals(id).toArray();
    await d.trades.bulkDelete(trades.map((t) => t.id));
    await d.cashflows.bulkDelete(flows.map((c) => c.id));
    await d.accounts.delete(id);
    await tomb(d, 'trades', trades.map((t) => t.id));
    await tomb(d, 'cashflows', flows.map((c) => c.id));
    await tomb(d, 'accounts', [id]);
  });
  return async () => {
    await d.transaction('rw', [d.accounts, d.trades, d.cashflows, d.tombstones], async () => {
      await d.accounts.put(acc!);
      await d.trades.bulkPut(trades);
      await d.cashflows.bulkPut(flows);
      await untomb(d, [id, ...trades.map((t) => t.id), ...flows.map((c) => c.id)]);
    });
  };
}

// ---------- Trades ----------

export async function addTrade(input: TradeInput, d: DaybookDB = defaultDb): Promise<{ trade: Trade; undo: Undo }> {
  const now = Date.now();
  const trade = assertOk(normalizeTrade({ ...input, id: newId(), createdAt: now, updatedAt: now }));
  if (!(await d.accounts.get(trade.accountId))) throw new Error('Account not found');
  await d.trades.add(trade);
  return {
    trade,
    undo: async () => {
      await d.trades.delete(trade.id);
    },
  };
}

export async function updateTrade(id: string, patch: Partial<TradeInput>, d: DaybookDB = defaultDb): Promise<Undo> {
  const prev = await d.trades.get(id);
  if (!prev) throw new Error('Trade not found');
  const next = assertOk(normalizeTrade({ ...prev, ...patch, id, createdAt: prev.createdAt, updatedAt: Date.now() }));
  await d.trades.put(next);
  return async () => {
    await d.trades.put(prev);
  };
}

export async function deleteTrades(ids: string[], d: DaybookDB = defaultDb): Promise<Undo> {
  const prev = (await d.trades.bulkGet(ids)).filter((t): t is Trade => !!t);
  await d.transaction('rw', [d.trades, d.tombstones], async () => {
    await d.trades.bulkDelete(ids);
    await tomb(d, 'trades', ids);
  });
  return async () => {
    await d.transaction('rw', [d.trades, d.tombstones], async () => {
      await d.trades.bulkPut(prev);
      await untomb(d, prev.map((t) => t.id));
    });
  };
}

// ---------- Cash flows ----------

export async function addCashFlow(input: CashFlowInput, d: DaybookDB = defaultDb): Promise<{ flow: CashFlow; undo: Undo }> {
  const now = Date.now();
  const flow = assertOk(normalizeCashFlow({ ...input, id: newId(), createdAt: now, updatedAt: now }));
  if (!(await d.accounts.get(flow.accountId))) throw new Error('Account not found');
  await d.cashflows.add(flow);
  return {
    flow,
    undo: async () => {
      await d.cashflows.delete(flow.id);
    },
  };
}

export async function updateCashFlow(id: string, patch: Partial<CashFlowInput>, d: DaybookDB = defaultDb): Promise<Undo> {
  const prev = await d.cashflows.get(id);
  if (!prev) throw new Error('Cash flow not found');
  const next = assertOk(normalizeCashFlow({ ...prev, ...patch, id, createdAt: prev.createdAt, updatedAt: Date.now() }));
  await d.cashflows.put(next);
  return async () => {
    await d.cashflows.put(prev);
  };
}

export async function deleteCashFlows(ids: string[], d: DaybookDB = defaultDb): Promise<Undo> {
  const prev = (await d.cashflows.bulkGet(ids)).filter((c): c is CashFlow => !!c);
  await d.transaction('rw', [d.cashflows, d.tombstones], async () => {
    await d.cashflows.bulkDelete(ids);
    await tomb(d, 'cashflows', ids);
  });
  return async () => {
    await d.transaction('rw', [d.cashflows, d.tombstones], async () => {
      await d.cashflows.bulkPut(prev);
      await untomb(d, prev.map((c) => c.id));
    });
  };
}

// ---------- Settings / wipe ----------

export const DEFAULT_SETTINGS: Settings = { lang: null, lastBackupAt: null };

export async function getSettings(d: DaybookDB = defaultDb): Promise<Settings> {
  const row = await d.meta.get('settings');
  return { ...DEFAULT_SETTINGS, ...((row?.value as Partial<Settings>) ?? {}) };
}

export async function saveSettings(patch: Partial<Settings>, d: DaybookDB = defaultDb): Promise<void> {
  await d.transaction('rw', d.meta, async () => {
    const cur = await getSettings(d);
    await d.meta.put({ key: 'settings', value: { ...cur, ...patch } });
  });
}

export async function eraseAllData(d: DaybookDB = defaultDb): Promise<void> {
  await d.transaction('rw', [d.accounts, d.trades, d.cashflows, d.tombstones, d.meta], async () => {
    await Promise.all([d.accounts.clear(), d.trades.clear(), d.cashflows.clear(), d.tombstones.clear()]);
    const s = await getSettings(d);
    await d.meta.clear();
    // keep only the language preference
    await d.meta.put({ key: 'settings', value: { ...DEFAULT_SETTINGS, lang: s.lang } });
  });
}
