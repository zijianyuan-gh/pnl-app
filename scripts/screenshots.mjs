// Production-build screenshots with synthetic demo data (never real data).
// Usage: npm run build && npx vite preview --port 4174 & node scripts/screenshots.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('@playwright/test'); } catch { pw = require('playwright'); }
const { chromium, devices } = pw;
const OUT = new URL('../docs/screenshots/', import.meta.url).pathname;
const URL_ = process.env.URL ?? 'http://localhost:4174/';

async function seed(page) {
  await page.evaluate(async () => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('daybook'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const tx = db.transaction(['accounts', 'trades', 'cashflows', 'meta'], 'readwrite');
    const now = Date.now();
    tx.objectStore('accounts').put({ id: 'a1', name: 'Stocks', startingBalanceCents: 2500000, startDate: '2026-06-01', color: '#4F8CFF', archived: false, sortOrder: 0, createdAt: now, updatedAt: now });
    tx.objectStore('accounts').put({ id: 'a2', name: 'Kalshi', startingBalanceCents: 300000, startDate: '2026-06-01', color: '#A78BFA', archived: false, sortOrder: 1, createdAt: now, updatedAt: now });
    let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const syms = ['AAPL', 'NVDA', 'TSLA', 'ES', 'FED-DEC', 'SPY', 'MSFT']; const tags = ['breakout', 'scalp', 'news', 'swing'];
    const d0 = new Date(); let n = 0;
    for (let m = 6; m <= d0.getMonth() + 1; m++) for (let d = 1; d <= 31; d++) {
      const dt = new Date(2026, m - 1, d);
      if (dt.getMonth() !== m - 1 || dt > d0 || [0, 6].includes(dt.getDay()) || rnd() < 0.2) continue;
      const iso = `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      for (let k = 0; k < 1 + Math.floor(rnd() * 3); k++) {
        const pnl = Math.round((rnd() - 0.43) * 80000);
        tx.objectStore('trades').put({ id: `t${n++}`, accountId: rnd() < 0.7 ? 'a1' : 'a2', date: iso, pnlCents: pnl, feesCents: rnd() < 0.4 ? 125 : null, symbol: syms[Math.floor(rnd() * syms.length)], platform: rnd() < 0.5 ? 'IBKR' : '', tags: rnd() < 0.6 ? [tags[Math.floor(rnd() * tags.length)]] : [], notes: '', side: rnd() < 0.5 ? 'long' : null, quantity: null, entryPrice: null, exitPrice: null, entryTime: null, exitTime: null, createdAt: now + n, updatedAt: now + n });
      }
    }
    tx.objectStore('cashflows').put({ id: 'c1', accountId: 'a1', date: '2026-09-02', type: 'deposit', amountCents: 500000, notes: 'Top up', createdAt: now, updatedAt: now });
    tx.objectStore('meta').put({ key: 'settings', value: { lang: null, lastBackupAt: now - 3 * 86400000 } });
    await new Promise((r) => (tx.oncomplete = r));
  });
}

const browser = await chromium.launch();
for (const [label, device, locale] of [['iphone14', devices['iPhone 14'], 'en-US'], ['iphoneSE', devices['iPhone SE'], 'en-US'], ['iphone14-zh', devices['iPhone 14'], 'zh-CN']]) {
  const ctx = await browser.newContext({ ...device, browserName: undefined, deviceScaleFactor: 2, locale });
  const page = await ctx.newPage();
  // standalone-like insets (status bar / home indicator)
  await page.addInitScript((se) => document.addEventListener('DOMContentLoaded', () => {
    document.documentElement.style.setProperty('--sat', se ? '20px' : '47px');
    document.documentElement.style.setProperty('--sab', se ? '0px' : '34px');
  }), label === 'iphoneSE');
  await page.goto(URL_);
  await page.waitForSelector('[data-testid=tab-calendar]');
  await seed(page);
  await page.reload();
  await page.waitForSelector('[data-testid=calendar]');
  await page.waitForTimeout(400);
  const shot = (n) => page.screenshot({ path: `${OUT}${label}-${n}.png` });
  await shot('1-calendar');
  if (label === 'iphone14-zh') { await ctx.close(); continue; }
  await page.click('[data-testid=tab-add]');
  await page.fill('[data-testid=qa-amount]', '-128.40');
  await page.waitForTimeout(400);
  await shot('2-quick-add');
  await page.keyboard.press('Escape');
  await page.evaluate(() => localStorage.clear());
  await page.click('[data-testid=tab-trades]'); await page.waitForTimeout(300); await shot('3-trades');
  await page.click('[data-testid=tab-analytics]'); await page.waitForTimeout(400); await shot('4-analytics');
  await page.click('[data-testid=tab-accounts]'); await page.waitForTimeout(300);
  await page.evaluate(() => document.getElementById('screen-accounts').scrollTo(0, 330)); await page.waitForTimeout(200);
  await shot('5-accounts-backup');
  if (label === 'iphone14') {
    await page.click('[data-testid=export-json]'); await page.waitForTimeout(500); await shot('6-export-sheet');
  }
  await ctx.close();
}
await browser.close();
console.log('screenshots written to', OUT);
