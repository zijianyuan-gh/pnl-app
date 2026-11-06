import { chromium, expect, test } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { addEntry, createAccount, gotoTab } from '../e2e/helpers';

/**
 * Re-deploying must never clear a user's data. A browser profile is kept between CI runs
 * (actions/cache). Each run opens it on the newly deployed build, checks the data written by
 * the previous run is still exactly there, then adds one more trade for the next run to check.
 */
const PROFILE = process.env.LIVE_PROFILE ?? 'live-profile';
const MARKER = join(PROFILE, 'daybook-marker.json');
const SHA = process.env.EXPECT_SHA ?? 'local';

test('data recorded before a redeploy is intact after it', async ({}, info) => {
  test.skip(info.project.name !== 'live-desktop-chromium', 'one persistent profile');
  mkdirSync(PROFILE, { recursive: true });
  const ctx = await chromium.launchPersistentContext(join(PROFILE, 'chromium'), { baseURL: info.project.use.baseURL, locale: 'en-US' });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto('./');
  await expect(page.getByTestId('tab-calendar')).toBeVisible();
  // the service worker may serve the previous build first; bring it up to the new one
  for (let i = 0; i < 6; i++) {
    if ((await page.locator('meta[name=daybook-build]').getAttribute('content')) === SHA) break;
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.update());
    const banner = page.getByTestId('update-reload');
    if (await banner.isVisible().catch(() => false)) await banner.click();
    await page.waitForTimeout(5000);
    await page.reload();
  }
  await expect(page.locator('meta[name=daybook-build]')).toHaveAttribute('content', SHA);

  const prev = existsSync(MARKER) ? (JSON.parse(readFileSync(MARKER, 'utf8')) as { sha: string; balance: string; trades: number }) : null;
  if (prev) {
    await gotoTab(page, 'accounts');
    await expect(page.getByTestId('total-balance')).toHaveText(prev.balance);
    await expect(page.locator('#screen-accounts')).toContainText(`${prev.trades} trade`);
    info.annotations.push({ type: 'verified', description: `data from build ${prev.sha.slice(0, 7)} intact on ${SHA.slice(0, 7)}` });
    console.log(`REDEPLOY CHECK: data written on ${prev.sha.slice(0, 7)} is intact on ${SHA.slice(0, 7)} (${prev.balance}, ${prev.trades} trades)`);
  } else {
    await createAccount(page, 'Redeploy', '100');
    console.log('REDEPLOY CHECK: baseline profile created; verified on the next deployment');
  }
  await addEntry(page, { amount: '1' });
  await gotoTab(page, 'accounts');
  const balance = (await page.getByTestId('total-balance').textContent())!;
  const trades = Number((await page.locator('#screen-accounts').textContent())!.match(/(\d+) trades?/)![1]);
  writeFileSync(MARKER, JSON.stringify({ sha: SHA, balance, trades }));
  await ctx.close();
});
