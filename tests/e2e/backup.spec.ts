import { expect, test } from '@playwright/test';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MINUS, addEntry, createAccount, freshApp, gotoTab } from './helpers';

// Desktop gets a regular download; on phones the share sheet is used (not automatable).
test.use({ hasTouch: false, isMobile: false, viewport: { width: 1100, height: 900 } });

test('Scenario C — export, erase, restore reproduces identical data and stats', async ({ page }) => {
  await freshApp(page);
  await createAccount(page, 'A', '1000', '2026-01-01');
  await createAccount(page, 'B', '2000', '2026-01-01');
  await addEntry(page, { account: 'A', amount: '200', date: '2026-10-30', symbol: 'AAPL', tag: 'breakout', fees: '1.25' });
  await addEntry(page, { account: 'A', amount: '50', loss: true, date: '2026-10-31' });
  await addEntry(page, { account: 'B', amount: '20.37', date: '2026-11-02' });
  await addEntry(page, { account: 'A', amount: '500', kind: 'deposit', date: '2026-11-01' });

  await gotoTab(page, 'accounts');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-json').click()]);
  expect(download.suggestedFilename()).toMatch(/^daybook-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
  const path = await download.path();
  const json = JSON.parse(readFileSync(path!, 'utf8'));
  expect(json.summary).toEqual({ accounts: 2, trades: 3, cashflows: 1, netPnlCents: 17037 });
  await expect(page.getByTestId('last-backup')).not.toHaveText('Never');

  // CSV export also works
  const [csvDl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-csv').click()]);
  const csv = readFileSync((await csvDl.path())!, 'utf8');
  expect(csv.split('\r\n')[0]).toBe('date,account,type,pnl,fees,symbol,platform,tags,side,quantity,entry_price,exit_price,entry_time,exit_time,notes,id');
  expect(csv).toContain('2026-10-30,A,trade,200.00,1.25,AAPL,,breakout');
  expect(csv).toContain('2026-10-31,A,trade,-50.00');

  // Erase
  await page.getByTestId('erase-all').click();
  await page.getByTestId('confirm-input').fill('ERASE');
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByTestId('total-balance')).toHaveCount(0);

  // A tampered file is rejected
  const dir = mkdtempSync(join(tmpdir(), 'daybook-'));
  const bad = structuredClone(json);
  bad.data.trades[0].pnlCents = 99999;
  writeFileSync(join(dir, 'bad.json'), JSON.stringify(bad));
  await page.getByTestId('restore-json').click();
  await page.getByTestId('restore-file').setInputFiles(join(dir, 'bad.json'));
  await expect(page.getByTestId('restore-error')).toContainText('SHA-256 checksum doesn’t match');

  // Restore the real backup
  await page.getByTestId('restore-file').setInputFiles(path!);
  await expect(page.getByTestId('restore-summary')).toHaveText('2 accounts · 3 trades · 1 transfer · Net P&L +$170.37');
  await expect(page.getByTestId('restore-integrity')).toContainText('Checksum verified (SHA-256)');
  await page.getByTestId('restore-run').click();
  await expect(page.getByTestId('restore-sheet')).toBeHidden();
  await expect(page.getByTestId('total-balance')).toHaveText('$3,670.37');

  // Stats identical
  await gotoTab(page, 'analytics');
  await expect(page.getByTestId('an-net')).toHaveText('+$170.37');
  await expect(page.getByTestId('an-trade-winrate-value')).toHaveText('66.7%');
  await expect(page.getByTestId('an-worst-day-value')).toHaveText(`${MINUS}$50.00`);
  await gotoTab(page, 'calendar');
  await page.getByTestId('prev-month').click();
  await expect(page.getByTestId('day-2026-10-30')).toHaveAttribute('data-pnl', '20000');
  await expect(page.getByTestId('day-2026-10-31')).toHaveAttribute('data-pnl', '-5000');

  // Merge-restoring the same file again creates no duplicates
  await gotoTab(page, 'accounts');
  await page.getByTestId('restore-json').click();
  await page.getByTestId('restore-file').setInputFiles(path!);
  await page.getByTestId('restore-mode-merge').click();
  await page.getByTestId('restore-run').click();
  await expect(page.getByTestId('total-balance')).toHaveText('$3,670.37');
  await expect(page.locator('#screen-accounts')).toContainText('2 accounts · 3 trades · 1 transfer');

  // Undo of a restore puts the previous data back exactly
  await page.getByTestId('restore-json').click();
  await page.getByTestId('restore-file').setInputFiles('tests/fixtures/backup-v1.0.json');
  await expect(page.getByTestId('restore-integrity')).toContainText('Older v1.0 backup');
  await page.getByTestId('restore-mode-replace').click();
  await page.getByTestId('restore-run').click();
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByTestId('total-balance')).toHaveText('$1,626.69'); // v1.0 fixture: 1649.02 + (−22.33)
  await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('total-balance')).toHaveText('$3,670.37');

  // Survives a full reload (IndexedDB persistence)
  await page.reload();
  await gotoTab(page, 'accounts');
  await expect(page.getByTestId('total-balance')).toHaveText('$3,670.37');
});

test('CSV import — mapping, preview, validation and duplicate protection', async ({ page }) => {
  await freshApp(page);
  await createAccount(page, 'Stocks', '0', '2026-01-01');
  await addEntry(page, { account: 'Stocks', amount: '125', date: '2026-03-02', symbol: 'TSLA' });
  const dir = mkdtempSync(join(tmpdir(), 'daybook-'));
  const file = join(dir, 'broker.csv');
  writeFileSync(
    file,
    [
      'Trade Date,Account,Ticker,Net P&L,Commission,Strategy',
      '03/02/2026,Stocks,TSLA,125.00,,',
      '03/04/2026,Kalshi,FED-RATE,(40.10),1.20,macro',
      '2026-02-30,Stocks,X,10,,',
      '2026-03-05,Stocks,Y,"$1,250.50",,swing',
    ].join('\n'),
  );
  await gotoTab(page, 'accounts');
  await page.getByTestId('import-csv').click();
  await page.getByTestId('csv-file').setInputFiles(file);
  await expect(page.getByTestId('map-date')).toHaveValue('0');
  await expect(page.getByTestId('map-pnl')).toHaveValue('3');
  await expect(page.getByTestId('csv-summary')).toHaveText('2 new · 1 duplicate · 1 error');
  await expect(page.getByTestId('csv-will-import')).toHaveText('Will import 2 trades and 0 transfers · Net P&L +$1,210.40');
  await expect(page.locator('[data-testid=csv-row][data-status=error]')).toContainText('Invalid date');
  await page.getByTestId('csv-run').click();
  await expect(page.getByTestId('csv-sheet')).toBeHidden();
  await expect(page.getByTestId('account-row-Kalshi')).toBeVisible();
  await gotoTab(page, 'analytics');
  await expect(page.getByTestId('an-net')).toHaveText('+$1,335.40');

  // Importing the same file again adds nothing
  await gotoTab(page, 'accounts');
  await page.getByTestId('import-csv').click();
  await page.getByTestId('csv-file').setInputFiles(file);
  await expect(page.getByTestId('csv-summary')).toHaveText('0 new · 3 duplicates · 1 error');
  await expect(page.getByTestId('csv-run')).toBeDisabled();
});

test('Undo of a restore is refused if data changed meanwhile (second tab) — nothing is overwritten', async ({ page, context }) => {
  await freshApp(page);
  await createAccount(page, 'A', '100', '2026-01-01');
  await gotoTab(page, 'accounts');
  await page.getByTestId('restore-json').click();
  await page.getByTestId('restore-file').setInputFiles('tests/fixtures/backup-v1.0.json');
  await page.getByTestId('restore-mode-merge').click();
  await page.getByTestId('restore-run').click();
  await expect(page.getByTestId('total-balance')).toHaveText('$1,726.69'); // 100 + v1.0 fixture 1,626.69

  // Meanwhile, in another tab of the same app, a trade is recorded
  const other = await context.newPage();
  await other.goto('./');
  await addEntry(other, { account: 'A', amount: '5', date: '2026-02-02' });
  await other.close();
  await expect(page.getByTestId('total-balance')).toHaveText('$1,731.69');

  // The stale Undo from the restore must not wipe that trade
  await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('status')).toContainText('Can’t undo');
  await expect(page.getByTestId('total-balance')).toHaveText('$1,731.69');
  await expect(page.locator('#screen-accounts')).toContainText('3 accounts · 4 trades · 2 transfers');
});
