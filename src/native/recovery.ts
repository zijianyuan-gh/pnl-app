import { parseBackup, type ParsedBackup } from '../db/backup';

/**
 * The iOS app keeps an automatic backup copy of all data in its Documents folder
 * (Files → On My iPhone → Daybook). This decides, at launch, whether to offer it back.
 *
 * Rules (each one exists to prevent data loss):
 *  - Only offered when the app's own database is completely empty (e.g. storage was cleared).
 *  - The current copy is preferred; the previous-day copy is used if the current one is
 *    missing, damaged or empty.
 *  - Copies older than an intentional "Erase all data" are never offered.
 *  - An empty database is never written over a copy (see shouldWriteSnapshot).
 */
export interface SnapshotFiles {
  text: string | null;
  modifiedAt: number | null;
  previousText: string | null;
  previousModifiedAt: number | null;
}

export type RecoveryDecision =
  | { action: 'none' }
  | { action: 'offer'; backup: ParsedBackup; modifiedAt: number | null; source: 'current' | 'previous' };

const hasRecords = (b: ParsedBackup) => b.accounts.length + b.trades.length + b.cashflows.length > 0;

export function decideRecovery(
  local: { accounts: number; trades: number; cashflows: number },
  files: SnapshotFiles,
  erasedAt: number | null,
): RecoveryDecision {
  if (local.accounts + local.trades + local.cashflows > 0) return { action: 'none' };
  const candidates: [string | null, number | null, 'current' | 'previous'][] = [
    [files.text, files.modifiedAt, 'current'],
    [files.previousText, files.previousModifiedAt, 'previous'],
  ];
  for (const [text, modifiedAt, source] of candidates) {
    if (!text) continue;
    if (erasedAt && modifiedAt && modifiedAt <= erasedAt) continue;
    const r = parseBackup(text);
    if (r.ok && hasRecords(r.backup)) return { action: 'offer', backup: r.backup, modifiedAt, source };
  }
  return { action: 'none' };
}

/** Never replace the automatic copy with an empty database. */
export function shouldWriteSnapshot(local: { accounts: number; trades: number; cashflows: number }): boolean {
  return local.accounts + local.trades + local.cashflows > 0;
}
