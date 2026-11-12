import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DaybookDB } from '../../src/db/db';
import { addTrade, createAccount, eraseAllData, getSettings } from '../../src/db/actions';
import { buildBackup, parseBackup, restoreBackup, serializeBackup } from '../../src/db/backup';
import { decideRecovery, shouldWriteSnapshot } from '../../src/native/recovery';

const empty = { accounts: 0, trades: 0, cashflows: 0 };
const v1 = readFileSync('tests/fixtures/backup-v1.0.json', 'utf8');

async function backupText(trades = 1) {
  const d = new DaybookDB(`rec-${Math.random()}`);
  const A = await createAccount({ name: 'A', startingBalanceCents: 0, startDate: '2026-01-01', color: '#4F8CFF' }, d);
  for (let i = 0; i < trades; i++) {
    await addTrade({ accountId: A.id, date: '2026-01-02', pnlCents: 100 + i, feesCents: null, symbol: '', platform: '', tags: [], notes: '', side: null, quantity: null, entryPrice: null, exitPrice: null, entryTime: null, exitTime: null }, d);
  }
  return serializeBackup(await buildBackup(d));
}

describe('iOS automatic backup copy — recovery decisions', () => {
  it('offers the copy only when the app database is completely empty', async () => {
    const text = await backupText();
    const files = { text, modifiedAt: 2000, previousText: null, previousModifiedAt: null };
    expect(decideRecovery(empty, files, null).action).toBe('offer');
    expect(decideRecovery({ accounts: 1, trades: 0, cashflows: 0 }, files, null).action).toBe('none');
    expect(decideRecovery({ accounts: 0, trades: 0, cashflows: 1 }, files, null).action).toBe('none');
  });

  it('accepts an existing PWA backup file (v1.0 and v1.1 formats) as the copy', async () => {
    const d = decideRecovery(empty, { text: v1, modifiedAt: 1, previousText: null, previousModifiedAt: null }, null);
    expect(d.action === 'offer' && d.backup.trades.length).toBe(3);
    const d2 = decideRecovery(empty, { text: await backupText(2), modifiedAt: 1, previousText: null, previousModifiedAt: null }, null);
    expect(d2.action === 'offer' && d2.backup.integrity).toBe('sha256');
  });

  it('falls back to the previous-day copy when the current one is damaged or empty', async () => {
    const good = await backupText(3);
    const emptyCopy = JSON.stringify({ ...JSON.parse(await backupText(0)) }); // valid file, but only an account
    for (const bad of ['{"truncated', 'not json', '']) {
      const d = decideRecovery(empty, { text: bad, modifiedAt: 5, previousText: good, previousModifiedAt: 4 }, null);
      expect(d.action === 'offer' && d.source).toBe('previous');
    }
    const tampered = JSON.parse(good);
    tampered.data.trades[0].pnlCents = 1;
    const d = decideRecovery(empty, { text: JSON.stringify(tampered), modifiedAt: 5, previousText: good, previousModifiedAt: 4 }, null);
    expect(d.action === 'offer' && d.source).toBe('previous');
    expect(decideRecovery(empty, { text: emptyCopy, modifiedAt: 5, previousText: null, previousModifiedAt: null }, null).action).toBe('offer'); // an account alone still counts
  });

  it('never offers copies older than an intentional "Erase all data"', async () => {
    const text = await backupText();
    expect(decideRecovery(empty, { text, modifiedAt: 1000, previousText: text, previousModifiedAt: 900 }, 1500).action).toBe('none');
    const d = decideRecovery(empty, { text, modifiedAt: 2000, previousText: text, previousModifiedAt: 900 }, 1500);
    expect(d.action === 'offer' && d.source).toBe('current');
  });

  it('never writes an empty database over the copy', () => {
    expect(shouldWriteSnapshot(empty)).toBe(false);
    expect(shouldWriteSnapshot({ accounts: 1, trades: 0, cashflows: 0 })).toBe(true);
  });

  it('Erase all data records erasedAt and keeps language and App Lock', async () => {
    const d = new DaybookDB(`erase-${Math.random()}`);
    const { saveSettings } = await import('../../src/db/actions');
    await saveSettings({ lang: 'zh', appLock: true }, d);
    const before = Date.now();
    await eraseAllData(d);
    const s = await getSettings(d);
    expect(s.lang).toBe('zh');
    expect(s.appLock).toBe(true);
    expect(s.erasedAt).toBeGreaterThanOrEqual(before);
  });

  it('restoring the offered copy reproduces the data exactly', async () => {
    const text = await backupText(4);
    const decision = decideRecovery(empty, { text, modifiedAt: 1, previousText: null, previousModifiedAt: null }, null);
    if (decision.action !== 'offer') throw new Error('expected offer');
    const d = new DaybookDB(`restore-${Math.random()}`);
    await restoreBackup(decision.backup, 'replace', d);
    const again = parseBackup(serializeBackup(await buildBackup(d)));
    expect(again.ok && again.backup.summary).toEqual(decision.backup.summary);
  });
});
