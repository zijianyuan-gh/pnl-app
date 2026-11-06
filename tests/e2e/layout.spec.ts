import { expect, test, type Page } from '@playwright/test';
import { freshApp, gotoTab } from './helpers';

const WIDTHS = [375, 390, 430, 1280];

async function seed(page: Page) {
  await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open('daybook');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const tx = db.transaction(['accounts', 'trades', 'cashflows'], 'readwrite');
    const now = Date.now();
    const d = new Date();
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    tx.objectStore('accounts').put({ id: 'a1', name: 'A very long brokerage account name', startingBalanceCents: 123456789, startDate: '2020-01-01', color: '#4F8CFF', archived: false, sortOrder: 0, createdAt: now, updatedAt: now });
    tx.objectStore('accounts').put({ id: 'a2', name: 'Kalshi', startingBalanceCents: 0, startDate: '2020-01-01', color: '#A78BFA', archived: false, sortOrder: 1, createdAt: now, updatedAt: now });
    // extreme values on every kind of day
    const vals = [-9999999, 123456789, 450, -92340, 99950, 1234567, -250000000, 1, -1, 0, 99999999];
    vals.forEach((v, i) => {
      for (let k = 0; k < (i % 3) + 1; k++) {
        tx.objectStore('trades').put({ id: `t${i}-${k}`, accountId: k ? 'a2' : 'a1', date: `${ym}-${String(i + 1).padStart(2, '0')}`, pnlCents: v, feesCents: 99999, symbol: 'VERYLONGSYMBOL-2026-DEC-RATE-HIKE', platform: 'Interactive Brokers Pro', tags: ['breakout', 'momentum-long-tag'], notes: 'n', side: 'short', quantity: null, entryPrice: null, exitPrice: null, entryTime: null, exitTime: null, createdAt: now + i, updatedAt: now + i });
      }
    });
    tx.objectStore('cashflows').put({ id: 'c1', accountId: 'a1', date: `${ym}-02`, type: 'withdrawal', amountCents: 12345678, notes: 'A long note about this withdrawal', createdAt: now, updatedAt: now });
    await new Promise((r) => (tx.oncomplete = r));
  });
  await page.reload();
}

/** Elements that stick out of the viewport horizontally (ignoring intentional horizontal scrollers). */
async function horizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const W = window.innerWidth;
    const bad: string[] = [];
    const scroller = (el: Element | null): boolean => {
      for (let e = el; e; e = e.parentElement) {
        const ox = getComputedStyle(e).overflowX;
        if (ox === 'auto' || ox === 'scroll') return true;
      }
      return false;
    };
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if ((r.right > W + 1 || r.left < -1) && !scroller(el.parentElement)) bad.push(`${el.tagName}.${(el.className as string).toString().slice(0, 60)} [${Math.round(r.left)},${Math.round(r.right)}]`);
    }
    return { docScroll: document.documentElement.scrollWidth - W, bad: bad.slice(0, 10) };
  });
}

for (const width of WIDTHS) {
  test.describe(`Scenario E — ${width}px`, () => {
    test.use({ viewport: { width, height: width > 600 ? 900 : 812 } });

    test('no overflow, clipping or overlap on any screen', async ({ page }, info) => {
      test.skip((width > 600) !== (info.project.name === 'desktop-chromium'), 'phone widths run on the phone project, desktop on desktop');
      await freshApp(page);
      await seed(page);
      const shot = async (name: string) => page.screenshot({ path: info.outputPath(`${width}-${name}.png`) });

      for (const tab of ['calendar', 'trades', 'analytics', 'accounts'] as const) {
        await gotoTab(page, tab);
        await page.waitForTimeout(150);
        const o = await horizontalOverflow(page);
        expect(o.docScroll, `${tab}: page scrolls horizontally`).toBeLessThanOrEqual(0);
        expect(o.bad, `${tab}: elements overflow`).toEqual([]);
        await shot(tab);
      }

      // Calendar cells: amount text fits inside every cell
      await gotoTab(page, 'calendar');
      const cellIssues = await page.evaluate(() => {
        const out: string[] = [];
        for (const c of document.querySelectorAll<HTMLElement>('[data-testid^="day-2"]')) {
          const cr = c.getBoundingClientRect();
          for (const s of c.querySelectorAll<HTMLElement>('span')) {
            const r = s.getBoundingClientRect();
            if (!r.width) continue;
            if (r.left < cr.left - 0.5 || r.right > cr.right + 0.5 || r.bottom > cr.bottom + 0.5)
              out.push(`${c.dataset.testid}: "${s.textContent}" ${Math.round(r.left - cr.left)}..${Math.round(r.right - cr.left)} of ${Math.round(cr.width)}`);
          }
        }
        return out;
      });
      expect(cellIssues).toEqual([]);

      // Trade rows: text never escapes its row (long names, many tags)
      for (const tab of ['calendar', 'trades'] as const) {
        await gotoTab(page, tab);
        const rowIssues = await page.evaluate((t) => {
          const out: string[] = [];
          for (const row of document.querySelectorAll<HTMLElement>(`#screen-${t} [data-testid=trade-row], #screen-${t} [data-testid=flow-row]`)) {
            const rr = row.getBoundingClientRect();
            for (const s of row.querySelectorAll<HTMLElement>('span')) {
              const r = s.getBoundingClientRect();
              const clippedByParent = s.parentElement && getComputedStyle(s.parentElement).overflow === 'hidden' && r.left >= s.parentElement.getBoundingClientRect().right - 1;
              if (r.width && !clippedByParent && r.right > rr.right + 0.5) out.push(`"${s.textContent?.slice(0, 30)}" ${Math.round(r.right - rr.right)}px`);
            }
          }
          return out.slice(0, 5);
        }, tab);
        expect(rowIssues, `${tab} rows`).toEqual([]);
      }
      await gotoTab(page, 'calendar');

      // Tab bar is fully on screen and nothing important hides behind it
      const nav = await page.getByRole('navigation', { name: 'Main' }).boundingBox();
      const vp = page.viewportSize()!;
      expect(nav!.y + nav!.height).toBeLessThanOrEqual(vp.height + 0.5);
      for (const t of ['tab-calendar', 'tab-trades', 'tab-add', 'tab-analytics', 'tab-accounts']) {
        const b = await page.getByTestId(t).boundingBox();
        expect(b!.height, `${t} touch target`).toBeGreaterThanOrEqual(44);
        expect(b!.width, `${t} touch target`).toBeGreaterThanOrEqual(44);
      }

      // Quick add sheet fits and its actions are reachable
      await page.getByTestId('tab-add').click();
      await page.getByTestId('qa-more').click();
      const dlg = await page.getByRole('dialog').boundingBox();
      expect(dlg!.x).toBeGreaterThanOrEqual(0);
      expect(dlg!.x + dlg!.width).toBeLessThanOrEqual(vp.width + 0.5);
      expect(dlg!.y).toBeGreaterThanOrEqual(0);
      expect(dlg!.y + dlg!.height).toBeLessThanOrEqual(vp.height + 0.5);
      await expect(page.getByTestId('qa-save')).toBeInViewport();
      const o = await horizontalOverflow(page);
      expect(o.bad).toEqual([]);
      await shot('quick-add');
      await page.keyboard.press('Escape');

      // Account detail sheet
      await gotoTab(page, 'accounts');
      await page.getByTestId('account-row-A very long brokerage account name').click();
      await expect(page.getByTestId('account-detail')).toBeVisible();
      expect((await horizontalOverflow(page)).bad).toEqual([]);
      await shot('account-detail');
    });
  });
}
