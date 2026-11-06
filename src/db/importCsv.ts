import { db as defaultDb, type DaybookDB } from './db';
import { ACCOUNT_COLORS, newId, type Account, type CashFlow, type Trade } from './types';
import { normalizeAccount, normalizeCashFlow, normalizeTrade } from './validate';
import type { ImportPreview } from '../lib/csv';
import { UndoConflictError } from './backup';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CommitResult {
  trades: number;
  cashflows: number;
  accountsCreated: number;
  tradeIds: string[];
  flowIds: string[];
  accountIds: string[];
  /** updatedAt written by the import; a different value later means the record was edited */
  importedAt: number;
}

/** Write an import preview to the database in one atomic transaction. */
export async function commitImport(
  preview: ImportPreview,
  includeDuplicates: boolean,
  d: DaybookDB = defaultDb,
): Promise<CommitResult> {
  const now = Date.now();
  const res: CommitResult = { trades: 0, cashflows: 0, accountsCreated: 0, tradeIds: [], flowIds: [], accountIds: [], importedAt: now };
  await d.transaction('rw', [d.accounts, d.trades, d.cashflows, d.tombstones], async () => {
    const refToId = new Map<string, string>();
    let order = await d.accounts.count();
    const existingNames = new Map((await d.accounts.toArray()).map((a) => [a.name.toLowerCase(), a.id]));
    for (const na of preview.newAccounts) {
      const existingId = existingNames.get(na.name.toLowerCase());
      if (existingId) {
        refToId.set(na.ref, existingId);
        continue;
      }
      const r = normalizeAccount({
        id: newId(),
        name: na.name,
        startingBalanceCents: 0,
        startDate: na.startDate,
        color: ACCOUNT_COLORS[order % ACCOUNT_COLORS.length],
        archived: false,
        sortOrder: order++,
        createdAt: now,
        updatedAt: now,
      });
      if (!r.ok) throw new Error(r.errors.join(', '));
      await d.accounts.add(r.value as Account);
      refToId.set(na.ref, r.value.id);
      res.accountIds.push(r.value.id);
      res.accountsCreated++;
    }
    const resolve = (ref: string) => (ref.startsWith('new:') ? refToId.get(ref) : ref);

    const trades: Trade[] = [];
    const flows: CashFlow[] = [];
    const takenIds = new Set<string>();
    for (const row of preview.rows) {
      if (!(row.status === 'ok' || (row.status === 'duplicate' && includeDuplicates))) continue;
      let id = newId();
      if (row.sourceId && UUID_RE.test(row.sourceId) && !takenIds.has(row.sourceId)) {
        // never reuse an id that exists or was deleted (a tombstoned id must stay deleted)
        const clash =
          (await d.trades.get(row.sourceId)) || (await d.cashflows.get(row.sourceId)) || (await d.tombstones.get(row.sourceId));
        if (!clash) id = row.sourceId;
      }
      takenIds.add(id);
      if (row.trade) {
        const accountId = resolve(row.trade.accountId);
        const r = normalizeTrade({ ...row.trade, accountId, id, createdAt: now, updatedAt: now });
        if (!r.ok) throw new Error(`line ${row.line}: ${r.errors.join(', ')}`);
        trades.push(r.value);
      } else if (row.flow) {
        const accountId = resolve(row.flow.accountId);
        const r = normalizeCashFlow({ ...row.flow, accountId, id, createdAt: now, updatedAt: now });
        if (!r.ok) throw new Error(`line ${row.line}: ${r.errors.join(', ')}`);
        flows.push(r.value);
      }
    }
    await d.trades.bulkAdd(trades);
    await d.cashflows.bulkAdd(flows);
    res.trades = trades.length;
    res.cashflows = flows.length;
    res.tradeIds = trades.map((t) => t.id);
    res.flowIds = flows.map((f) => f.id);
  });
  return res;
}

/**
 * Remove exactly what an import added — refused (UndoConflictError, nothing written) if any
 * imported record was edited or deleted since, or anything new was put into a created account.
 */
export async function undoImport(r: CommitResult, d: DaybookDB = defaultDb): Promise<void> {
  await d.transaction('rw', [d.accounts, d.trades, d.cashflows], async () => {
    const trades = await d.trades.bulkGet(r.tradeIds);
    const flows = await d.cashflows.bulkGet(r.flowIds);
    const accounts = await d.accounts.bulkGet(r.accountIds);
    const untouched = [...trades, ...flows, ...accounts].every((x) => x && x.updatedAt === r.importedAt);
    const created = new Set(r.accountIds);
    const imported = new Set([...r.tradeIds, ...r.flowIds]);
    const othersInCreated =
      created.size > 0 &&
      ((await d.trades.where('accountId').anyOf([...created]).filter((t) => !imported.has(t.id)).count()) > 0 ||
        (await d.cashflows.where('accountId').anyOf([...created]).filter((c) => !imported.has(c.id)).count()) > 0);
    if (!untouched || othersInCreated) throw new UndoConflictError();
    await d.trades.bulkDelete(r.tradeIds);
    await d.cashflows.bulkDelete(r.flowIds);
    await d.accounts.bulkDelete(r.accountIds);
  });
}
