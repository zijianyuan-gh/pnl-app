import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { addEntry, createAccount, gotoTab, MINUS, openQuickAdd } from './helpers';
import { serveDistCopy } from './server';

/**
 * The V1.1 acceptance criterion, end to end on the production build:
 * record a real trade → quit → reopen → offline → export → restore → update → still exact.
 */
test.beforeEach(({}, info) => test.skip(info.project.name !== 'desktop-chromium', 'downloads + SW automation: desktop Chromium'));

// Dates relative to today, so the trade is always in the month the calendar opens on
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const TODAY = iso(new Date());
const YESTERDAY = iso(new Date(Date.now() - 86_400_000));
const TODAY_LABEL = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date());
const TRADE = { account: 'Real', amount: '1234.56', date: TODAY, symbol: 'NVDA', fees: '1.23', tag: 'swing' };

async function waitForSW(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

/** Every stored field of the trade is exactly what was typed. */
async function expectTradeExact(page: Page, balance: string) {
  await gotoTab(page, 'calendar');
  await expect(page.getByTestId('header-balance')).toHaveText(balance);
  await expect(page.getByTestId(`day-${TODAY}`)).toHaveAttribute('data-pnl', '123456');
  await gotoTab(page, 'trades');
  await page.getByTestId('trades-search').fill('NVDA');
  const row = page.locator('#screen-trades [data-testid=trade-row]');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('+$1,234.56');
  await expect(row).toContainText('Fees $1.23');
  await expect(page.locator('#screen-trades')).toContainText(TODAY_LABEL);
  await row.click();
  const qa = page.getByTestId('quick-add');
  await expect(qa.getByTestId('qa-amount')).toHaveValue('1234.56');
  await expect(qa.getByTestId('sign-profit')).toHaveAttribute('aria-checked', 'true');
  await expect(qa.getByTestId('qa-date')).toHaveValue(TODAY);
  await expect(qa.getByTestId('qa-symbol')).toHaveValue('NVDA');
  await expect(qa.getByTestId('qa-fees')).toHaveValue('1.23');
  await expect(qa).toContainText('swing');
  await qa.getByRole('button', { name: 'Cancel' }).click();
  await expect(qa).toBeHidden();
  await page.getByTestId('trades-search').fill('');
}

test('real-trade lifecycle: reopen, offline, export, restore, update', async ({ browser }) => {
  const { server, publishNewVersion } = await serveDistCopy(4191);
  const origin = `http://localhost:4191${process.env.BASE_PATH ?? '/'}`;
  const context = await browser.newContext({ acceptDownloads: true, locale: 'en-US', viewport: { width: 1000, height: 900 } });
  try {
    // 1. First launch, record the trade
    let page = await context.newPage();
    await page.goto(origin);
    await waitForSW(page);
    await createAccount(page, 'Real', '2500', '2026-01-01');
    await addEntry(page, TRADE);
    await expectTradeExact(page, '$3,734.56');

    // 2. Quit and reopen the app
    await page.close();
    page = await context.newPage();
    await page.goto(origin);
    await expectTradeExact(page, '$3,734.56');

    // 3. Offline: cold start, still there; record another trade offline
    await context.setOffline(true);
    await page.close();
    page = await context.newPage();
    await page.goto(origin);
    await expectTradeExact(page, '$3,734.56');
    await addEntry(page, { amount: '34.56', loss: true, date: YESTERDAY, symbol: 'OFFLINE' });
    await gotoTab(page, 'calendar');
    await expect(page.getByTestId('header-balance')).toHaveText('$3,700.00');

    // 4. Export a backup while offline
    await gotoTab(page, 'accounts');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-json').click()]);
    const backupPath = (await dl.path())!;
    const file = JSON.parse(readFileSync(backupPath, 'utf8'));
    const t = file.data.trades.find((x: { symbol: string }) => x.symbol === 'NVDA');
    expect(t).toMatchObject({ date: TODAY, pnlCents: 123456, feesCents: 123, symbol: 'NVDA', tags: ['swing'] });
    expect(file.integrity.algorithm).toBe('SHA-256');

    // 5. Back online, reopen: offline entry persisted
    await context.setOffline(false);
    await page.reload();
    await gotoTab(page, 'calendar');
    await expect(page.getByTestId('header-balance')).toHaveText('$3,700.00');

    // 6. Erase everything, restore from the backup
    await gotoTab(page, 'accounts');
    await page.getByTestId('erase-all').click();
    await page.getByTestId('confirm-input').fill('ERASE');
    await page.getByTestId('confirm-ok').click();
    await expect(page.getByTestId('total-balance')).toHaveCount(0);
    await page.getByTestId('restore-json').click();
    await page.getByTestId('restore-file').setInputFiles(backupPath);
    await expect(page.getByTestId('restore-integrity')).toContainText('Checksum verified');
    await page.getByTestId('restore-run').click();
    await expectTradeExact(page, '$3,700.00');

    // 7. A new version is deployed while an entry is half-typed: nothing reloads by itself
    await openQuickAdd(page);
    await page.getByTestId('qa-amount').fill('77.7');
    publishNewVersion('v1.1-test');
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update());
    await expect(page.getByTestId('update-banner')).toBeAttached({ timeout: 15_000 });
    await page.waitForTimeout(1500);
    await expect(page.getByTestId('qa-amount')).toHaveValue('77.7'); // untouched
    await page.getByTestId('quick-add').getByRole('button', { name: 'Cancel' }).click();
    // the half-typed entry is kept as a draft
    await page.getByTestId('update-reload').click();
    await expect(page.locator('meta[name=build-marker]')).toHaveAttribute('content', 'v1.1-test', { timeout: 15_000 });
    await expectTradeExact(page, '$3,700.00');
    await openQuickAdd(page);
    await expect(page.getByTestId('draft-notice')).toBeVisible();
    await expect(page.getByTestId('qa-amount')).toHaveValue('77.7');
    await page.getByTestId('draft-discard').click();
    await expect(page.getByTestId('qa-amount')).toHaveValue('');
    await page.getByTestId('quick-add').getByRole('button', { name: 'Cancel' }).click();

    // 8. A second "device" (fresh browser storage) restores the same file by merge
    const other = await browser.newContext({ locale: 'en-US', viewport: { width: 1000, height: 900 } });
    const p2 = await other.newPage();
    await p2.goto(origin);
    await gotoTab(p2, 'accounts');
    await p2.getByTestId('restore-json').click();
    await p2.getByTestId('restore-file').setInputFiles(backupPath);
    await p2.getByTestId('restore-mode-merge').click();
    await p2.getByTestId('restore-run').click();
    await expectTradeExact(p2, '$3,700.00');
    await gotoTab(p2, 'analytics');
    await expect(p2.getByTestId('an-alltime')).toHaveText('+$1,200.00');
    await expect(p2.getByTestId('an-worst-day-value')).toHaveText(`${MINUS}$34.56`);
    await other.close();
  } finally {
    await context.close();
    server.close();
  }
});
