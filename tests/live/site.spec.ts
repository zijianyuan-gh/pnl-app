import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { addEntry, createAccount, freshApp, gotoTab } from '../e2e/helpers';

const SHA = process.env.EXPECT_SHA;

test('the live site is the build that was just deployed, over HTTPS, with PWA assets', async ({ page, request, baseURL }) => {
  const local = ['localhost', '127.0.0.1'].includes(new URL(baseURL!).hostname);
  if (!local) expect(baseURL!.startsWith('https://')).toBe(true);
  const res = await page.goto('./');
  expect(res!.status()).toBe(200);
  if (SHA) await expect(page.locator('meta[name=daybook-build]')).toHaveAttribute('content', SHA);
  await expect(page.locator('meta[http-equiv=Content-Security-Policy]')).toHaveAttribute('content', /connect-src 'self'/);
  const path = new URL(baseURL!).pathname;
  const m = await (await request.get('manifest.webmanifest')).json();
  expect(m).toMatchObject({ display: 'standalone', start_url: path, scope: path });
  for (const i of m.icons) expect((await request.get(i.src)).status(), i.src).toBe(200);
  expect((await request.get('sw.js')).status()).toBe(200);
  expect((await request.get('icons/apple-touch-icon.png')).status()).toBe(200);
});

test('a first-time visitor gets an empty app — no shipped trades', async ({ page }) => {
  await freshApp(page);
  await expect(page.getByTestId('welcome-create')).toBeVisible();
  await gotoTab(page, 'accounts');
  await expect(page.locator('#screen-accounts')).toContainText('0 accounts · 0 trades · 0 transfers');
});

test('Calendar, Quick Add, Analytics, Accounts and both languages work', async ({ page }) => {
  await freshApp(page);
  await createAccount(page, 'Live', '1000');
  await addEntry(page, { amount: '123.45', symbol: 'LIVE' });
  await addEntry(page, { amount: '23.45', loss: true });
  await gotoTab(page, 'calendar');
  await expect(page.getByTestId('header-balance')).toHaveText('$1,100.00');
  await expect(page.getByTestId('header-month-pnl')).toHaveText('+$100.00');
  await gotoTab(page, 'analytics');
  await expect(page.getByTestId('an-trade-winrate-value')).toHaveText('50.0%');
  await gotoTab(page, 'accounts');
  await expect(page.getByTestId('total-balance')).toHaveText('$1,100.00');
  await page.getByRole('radio', { name: '中文' }).click();
  await expect(page.getByTestId('tab-calendar')).toContainText('日历');
  await expect(page.getByTestId('tab-analytics')).toContainText('统计');
  await page.getByRole('radio', { name: 'EN' }).click();
  await expect(page.getByTestId('tab-calendar')).toContainText('Calendar');
  // phone layout: nothing scrolls sideways
  for (const tab of ['calendar', 'trades', 'analytics', 'accounts'] as const) {
    await gotoTab(page, tab);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), tab).toBeLessThanOrEqual(0);
  }
});

test('saved data survives quitting, works offline (service worker), and export → restore is exact', async ({ page, context }, info) => {
  await freshApp(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 20_000 }).toBe(true);
  await createAccount(page, 'Real', '2500', '2026-01-01');
  await addEntry(page, { amount: '1234.56', date: '2026-11-05', symbol: 'NVDA', fees: '1.23' });
  await page.close();
  page = await context.newPage();
  await page.goto('./');
  await expect(page.getByTestId('header-balance')).toHaveText('$3,734.56');

  await context.setOffline(true);
  await page.close();
  page = await context.newPage();
  await page.goto('./');
  await expect(page.getByTestId('header-balance')).toHaveText('$3,734.56');
  await addEntry(page, { amount: '34.56', loss: true, date: '2026-11-06' });
  await expect(page.getByTestId('header-balance')).toHaveText('$3,700.00');
  await context.setOffline(false);

  if (info.project.name !== 'live-desktop-chromium') return; // file download automation: desktop
  await gotoTab(page, 'accounts');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-json').click()]);
  const path = (await dl.path())!;
  expect(JSON.parse(readFileSync(path, 'utf8')).integrity.algorithm).toBe('SHA-256');
  await page.getByTestId('erase-all').click();
  await page.getByTestId('confirm-input').fill('ERASE');
  await page.getByTestId('confirm-ok').click();
  await page.getByTestId('restore-json').click();
  await page.getByTestId('restore-file').setInputFiles(path);
  await expect(page.getByTestId('restore-integrity')).toContainText('Checksum verified');
  await page.getByTestId('restore-run').click();
  await expect(page.getByTestId('total-balance')).toHaveText('$3,700.00');
  await gotoTab(page, 'trades');
  await expect(page.locator('#screen-trades')).toContainText('+$1,234.56');
});
