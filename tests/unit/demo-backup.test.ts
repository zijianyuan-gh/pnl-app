import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { parseBackup } from '../../src/db/backup';
import { combinedBalance } from '../../src/lib/stats';
import { formatMoney } from '../../src/lib/money';

it('the synthetic demo backup used by the iOS tests is accepted by the app (SHA-256) and matches its expectations', () => {
  const dir = mkdtempSync(join(tmpdir(), 'daybook-demo-'));
  execFileSync('node', ['scripts/make-demo-backup.mjs', dir]);
  const r = parseBackup(readFileSync(join(dir, 'demo-backup.json'), 'utf8'));
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.backup.integrity).toBe('sha256');
  const expected = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8'));
  expect(r.backup.trades.length).toBe(expected.trades);
  expect(formatMoney(combinedBalance(r.backup.accounts, r.backup.trades, r.backup.cashflows).estimatedCents)).toBe(expected.balance);
});
