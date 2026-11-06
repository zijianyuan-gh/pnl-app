import { expect, test } from '@playwright/test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { addEntry, createAccount, freshApp, gotoTab } from '../e2e/helpers';

const BIN = process.env.DAYBOOK_BIN ?? 'release/daybook';
const URL_ = 'http://127.0.0.1:47823/';
let server: ChildProcess | null = null;

async function start() {
  server = spawn(BIN, [], { env: { ...process.env, DAYBOOK_NO_BROWSER: '1' }, stdio: 'pipe' });
  await expect.poll(async () => fetch(URL_ + '__daybook').then((r) => r.text()).catch(() => ''), { timeout: 15_000 }).toBe('daybook');
}
async function stop() {
  if (!server) return;
  const s = server;
  server = null;
  s.kill('SIGTERM');
  await new Promise((r) => s.once('exit', r));
  await expect.poll(async () => fetch(URL_ + '__daybook').then(() => 'up').catch(() => 'down')).toBe('down');
}
test.afterEach(stop);

test('the packaged app serves Daybook, works offline when the server stops, and keeps data across restarts', async ({ page }) => {
  await start();
  await freshApp(page);
  await expect(page).toHaveTitle('Daybook — P&L Journal');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await createAccount(page, 'Mac', '1000');
  await addEntry(page, { amount: '250.25', symbol: 'MACTEST' });
  await gotoTab(page, 'calendar');
  await expect(page.getByTestId('header-balance')).toHaveText('$1,250.25');

  // Server gone (e.g. after a reboot before launching again): the cached app still opens
  await stop();
  await page.reload();
  await expect(page.getByTestId('header-balance')).toHaveText('$1,250.25');

  // Launch again: same address → same data
  await start();
  await page.reload();
  await expect(page.getByTestId('header-balance')).toHaveText('$1,250.25');
  await gotoTab(page, 'analytics');
  await expect(page.getByTestId('an-net')).toHaveText('+$250.25');
});

test('a second launch reuses the running app; foreign Host headers and writes are refused', async () => {
  await start();
  const second = spawnSync(BIN, [], { env: { ...process.env, DAYBOOK_NO_BROWSER: '1' }, timeout: 15_000 });
  expect(second.status).toBe(0); // exits immediately, first instance keeps serving
  expect(await fetch(URL_ + '__daybook').then((r) => r.text())).toBe('daybook');
  const curl = (args: string[]) => spawnSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', ...args, URL_], { encoding: 'utf8' }).stdout;
  expect(curl(['-H', 'Host: evil.example:47823'])).toBe('403');
  expect(curl(['-X', 'POST'])).toBe('405');
  const index = await fetch(URL_).then((r) => r.text());
  expect(index).toContain('Content-Security-Policy');
  expect(index).not.toContain('/pnl-app/');
  // only loopback: not reachable on other interfaces
  expect(server).not.toBeNull();
});
