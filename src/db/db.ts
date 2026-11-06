import Dexie, { type EntityTable } from 'dexie';
import type { Account, CashFlow, MetaRow, Tombstone, Trade } from './types';

/**
 * IndexedDB database (via Dexie).
 *
 * Schema history — when changing the schema, ADD a new `this.version(n)` block below,
 * never edit an existing one, and give it an `.upgrade()` for data transforms.
 * Also bump BACKUP_FORMAT in backup.ts if the backup JSON shape changes and add a
 * converter in `upgradeBackup()`.
 *
 *  v1 (2026-11): accounts, trades, cashflows, tombstones, meta
 */
export const DB_NAME = 'daybook';
export const SCHEMA_VERSION = 1;

export class DaybookDB extends Dexie {
  accounts!: EntityTable<Account, 'id'>;
  trades!: EntityTable<Trade, 'id'>;
  cashflows!: EntityTable<CashFlow, 'id'>;
  tombstones!: EntityTable<Tombstone, 'id'>;
  meta!: EntityTable<MetaRow, 'key'>;

  constructor(name = DB_NAME) {
    super(name);
    this.version(1).stores({
      accounts: 'id, sortOrder, updatedAt',
      trades: 'id, accountId, date, [accountId+date], updatedAt',
      cashflows: 'id, accountId, date, updatedAt',
      tombstones: 'id, table, deletedAt',
      meta: 'key',
    });
  }
}

export const db = new DaybookDB();

/** Ask the browser not to evict our data under storage pressure. */
export async function requestPersistentStorage(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

export async function isStoragePersisted(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persisted) return null;
    return await navigator.storage.persisted();
  } catch {
    return null;
  }
}
