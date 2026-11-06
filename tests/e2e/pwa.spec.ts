import { expect, test } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { addEntry, createAccount, freshApp, gotoTab } from './helpers';
const BASE = process.env.BASE_PATH ?? '/';

test.skip(({ browserName }) => browserName !== 'chromium', 'service-worker automation uses Chromium');

test('Scenario F — manifest, icons and iOS meta are correct', async ({ page, request }) => {
  const m = await (await request.get('manifest.webmanifest')).json();
  expect(m).toMatchObject({ name: 'Daybook — P&L Journal', short_name: 'Daybook', display: 'standalone', start_url: BASE, scope: BASE });
  expect(m.theme_color).toBe('#0a0a0b');
  for (const icon of m.icons) {
    const r = await request.get(icon.src);
    expect(r.status(), icon.src).toBe(200);
    expect(r.headers()['content-type']).toContain('image/png');
  }
  expect(m.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true);
  await page.goto('./');
  await expect(page.locator('meta[name=apple-mobile-web-app-capable]')).toHaveAttribute('content', 'yes');
  await expect(page.locator('meta[name=viewport]')).toHaveAttribute('content', /viewport-fit=cover/);
  const touchIcon = await page.locator('link[rel=apple-touch-icon]').getAttribute('href');
  expect((await request.get(new URL(touchIcon!, page.url()).href)).status()).toBe(200);
  await expect(page.locator('link[rel=manifest]')).toHaveCount(1);
});

test('Scenario F — works offline after the first load (view + record)', async ({ page, context }) => {
  await freshApp(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await createAccount(page, 'Main', '1000');
  await addEntry(page, { amount: '42' });

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('header-balance')).toHaveText('$1,042.00');
  await addEntry(page, { amount: '8', loss: true });
  await expect(page.getByTestId('header-balance')).toHaveText('$1,034.00');
  await gotoTab(page, 'analytics');
  await expect(page.getByTestId('an-net')).toHaveText('+$34.00');
  // a cold start while offline still has everything
  await page.reload();
  await expect(page.getByTestId('header-balance')).toHaveText('$1,034.00');
  await context.setOffline(false);
});

// Serve a copy of dist/ so the test can publish a "new version" mid-session.
function serve(dir: string, port: number): Promise<Server> {
  const types: Record<string, string> = {
    '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
    '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml',
  };
  const server = createServer((req, res) => {
    let p = normalize(decodeURIComponent((req.url ?? '/').split('?')[0]));
    if (BASE !== '/' && p.startsWith(BASE)) p = '/' + p.slice(BASE.length);
    if (p.endsWith('/')) p += 'index.html';
    const file = join(dir, p);
    if (!file.startsWith(dir) || !existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(readFileSync(file));
  });
  return new Promise((r) => server.listen(port, () => r(server)));
}

test('Scenario F — a new deployment is detected and applied; data survives the update', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chromium', 'run once');
  const dir = mkdtempSync(join(tmpdir(), 'daybook-dist-'));
  cpSync('dist', dir, { recursive: true });
  const port = 4190;
  const server = await serve(dir, port);
  try {
    await page.goto(`http://localhost:${port}${BASE}`);
    await expect(page.getByTestId('tab-calendar')).toBeVisible();
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await createAccount(page, 'Main', '500');

    // Publish v2: change index.html and its precache revision in sw.js
    const html = readFileSync(join(dir, 'index.html'), 'utf8').replace('</head>', '<meta name="build-marker" content="v2"></head>');
    writeFileSync(join(dir, 'index.html'), html);
    const sw = readFileSync(join(dir, 'sw.js'), 'utf8');
    const sw2 = sw.replace(/(url:"index\.html",revision:")[^"]+"/, '$1v2-test"');
    expect(sw2).not.toBe(sw);
    writeFileSync(join(dir, 'sw.js'), sw2);

    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update());
    await expect(page.getByTestId('update-banner')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('update-banner').getByRole('button').click();
    await expect(page.locator('meta[name=build-marker]')).toHaveAttribute('content', 'v2', { timeout: 15_000 });
    await gotoTab(page, 'accounts');
    await expect(page.getByTestId('total-balance')).toHaveText('$500.00');
  } finally {
    server.close();
  }
});
