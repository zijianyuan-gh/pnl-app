import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { addEntry, createAccount, freshApp, gotoTab, openQuickAdd } from './helpers';

/**
 * iPhone-specific behaviour, emulated in Chromium (iPhone 14 viewport, touch, iOS user agent).
 * This is NOT real iOS Safari/WebKit; see README → "Manual iPhone acceptance".
 */
test.beforeEach(({}, info) => test.skip(info.project.name === 'desktop-chromium', 'phone project only'));

test('export on a phone: file prepared first, share sheet invoked inside the tap', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __share?: { name: string; activeAtCall: boolean; size: number } };
    // Stand-in for the iOS share sheet; records whether the call happened during a user gesture
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: { files: File[] }) => {
        w.__share = { name: data.files[0].name, size: data.files[0].size, activeAtCall: (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive ?? true };
      },
    });
  });
  await freshApp(page);
  await createAccount(page, 'Main', '100');
  await addEntry(page, { amount: '12.34' });
  await gotoTab(page, 'accounts');
  await page.getByTestId('export-json').click();
  const sheet = page.getByTestId('export-sheet');
  await expect(sheet).toContainText(/daybook-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json/);
  await expect(sheet).toContainText('SHA-256');
  await expect(sheet).toContainText('Save to Files');
  await sheet.getByTestId('export-deliver').click();
  await expect(sheet).toBeHidden();
  const shared = await page.evaluate(() => (window as unknown as { __share: { name: string; activeAtCall: boolean; size: number } }).__share);
  expect(shared.name).toMatch(/\.json$/);
  expect(shared.size).toBeGreaterThan(500);
  expect(shared.activeAtCall).toBe(true);
  await expect(page.getByTestId('last-backup')).not.toHaveText('Never');
});

test('export on a phone without a share sheet falls back to a download', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
  });
  await freshApp(page);
  await createAccount(page, 'Main', '100');
  await gotoTab(page, 'accounts');
  await page.getByTestId('export-csv').click();
  await expect(page.getByTestId('export-sheet')).toContainText('Download file');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-deliver').click()]);
  expect(dl.suggestedFilename()).toMatch(/\.csv$/);
});

test('tapping + focuses the amount field (keyboard priming) and the decimal keypad is requested', async ({ page }) => {
  await freshApp(page);
  await createAccount(page, 'Main', '0');
  await page.getByTestId('tab-add').click();
  await expect(page.getByTestId('qa-amount')).toBeFocused();
  await expect(page.getByTestId('qa-amount')).toHaveAttribute('inputmode', 'decimal');
});

test('comma-decimal keypads (e.g. German region) record the right amount', async ({ page }) => {
  await freshApp(page);
  await createAccount(page, 'Main', '0');
  await openQuickAdd(page);
  await page.getByTestId('qa-amount').fill('12,50');
  await expect(page.getByTestId('quick-add')).toContainText('Net realized P&L: +$12.50');
  await page.getByTestId('qa-save').click();
  await expect(page.getByTestId('header-month-pnl')).toHaveText('+$12.50');
});

test('an unsaved entry survives the app being killed/reloaded', async ({ page }) => {
  await freshApp(page);
  await createAccount(page, 'Main', '0');
  await openQuickAdd(page);
  await page.getByTestId('qa-amount').fill('42.5');
  await page.getByTestId('sign-loss').click();
  await page.reload(); // what an update reload or an iOS memory kill looks like
  await openQuickAdd(page);
  await expect(page.getByTestId('draft-notice')).toBeVisible();
  await expect(page.getByTestId('qa-amount')).toHaveValue('42.5');
  await expect(page.getByTestId('sign-loss')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('qa-save').click();
  await expect(page.getByTestId('header-month-pnl')).toHaveText('−$42.50');
  await openQuickAdd(page);
  await expect(page.getByTestId('draft-notice')).toHaveCount(0);
  await expect(page.getByTestId('qa-amount')).toHaveValue('');
});

test('with the on-screen keyboard up, Save stays above it', async ({ page }) => {
  // Simulate iOS: the visual viewport shrinks by the keyboard height (336pt on iPhone 14 decimal pad)
  await page.addInitScript(() => {
    const target = new EventTarget();
    const vv = { height: window.innerHeight, width: window.innerWidth, offsetTop: 0, offsetLeft: 0, pageTop: 0, pageLeft: 0, scale: 1, onresize: null, onscroll: null,
      addEventListener: target.addEventListener.bind(target), removeEventListener: target.removeEventListener.bind(target), dispatchEvent: target.dispatchEvent.bind(target) };
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
    (window as unknown as { __kb: (h: number) => void }).__kb = (h: number) => {
      vv.height = window.innerHeight - h;
      target.dispatchEvent(new Event('resize'));
    };
  });
  await freshApp(page);
  await createAccount(page, 'Main', '0');
  await openQuickAdd(page);
  await page.getByTestId('qa-more').click();
  await page.evaluate(() => (window as unknown as { __kb: (h: number) => void }).__kb(336));
  const vh = page.viewportSize()!.height;
  await expect.poll(async () => { const b = (await page.getByTestId('qa-save').boundingBox())!; return b.y + b.height; }).toBeLessThanOrEqual(vh - 336 + 0.5);
  const top = (await page.getByTestId('qa-save-top').boundingBox())!;
  expect(top.y).toBeGreaterThanOrEqual(0);
  // the amount field is still visible above the keyboard
  const amt = (await page.getByTestId('qa-amount').boundingBox())!;
  expect(amt.y + amt.height).toBeLessThanOrEqual(vh - 336);
  await page.getByTestId('qa-amount').fill('5');
  await page.getByTestId('qa-save').click();
  await expect(page.getByTestId('quick-add')).toBeHidden();
});

test('safe areas: nothing sits under the notch / status bar or the home indicator', async ({ page }) => {
  // iPhone 14 portrait insets; CSS reads them through --sat/--sab (set from env() on real devices)
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.style.setProperty('--sat', '47px');
      document.documentElement.style.setProperty('--sab', '34px');
    });
  });
  await freshApp(page);
  await createAccount(page, 'Main', '0');
  const vh = page.viewportSize()!.height;
  for (const tab of ['calendar', 'trades', 'analytics', 'accounts'] as const) {
    await gotoTab(page, tab);
    const h1 = (await page.locator(`#screen-${tab} h1`).first().boundingBox())!;
    expect(h1.y, `${tab} title under status bar`).toBeGreaterThanOrEqual(47);
  }
  for (const t of ['tab-calendar', 'tab-add', 'tab-accounts']) {
    const b = (await page.getByTestId(t).boundingBox())!;
    expect(b.y + b.height, `${t} over home indicator`).toBeLessThanOrEqual(vh - 34 + 0.5);
  }
  await openQuickAdd(page);
  // wait for the slide-in animation to finish
  await expect.poll(async () => { const b = (await page.getByTestId('qa-save').boundingBox())!; return b.y + b.height; }, { timeout: 3000 }).toBeLessThanOrEqual(vh - 34 + 0.5);
  const dlg = (await page.getByRole('dialog').boundingBox())!;
  expect(dlg.y).toBeGreaterThanOrEqual(47);
});

test('Safari tab vs Home Screen mode is detected and explained', async ({ page, context }) => {
  await freshApp(page);
  await gotoTab(page, 'accounts');
  await expect(page.getByTestId('display-mode')).toContainText('browser tab');
  await expect(page.getByTestId('safari-tab-warning')).toContainText('Add Daybook to your Home Screen');
  const standalone = await context.newPage();
  await standalone.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true, configurable: true }));
  await standalone.goto('/');
  await gotoTab(standalone, 'accounts');
  await expect(standalone.getByTestId('display-mode')).toContainText('Home Screen app');
  await expect(standalone.getByTestId('safari-tab-warning')).toHaveCount(0);
});

test('VoiceOver semantics and WCAG AA contrast (axe-core) on every screen and the entry sheet', async ({ page }) => {
  await freshApp(page);
  await createAccount(page, 'Stocks', '1000');
  await addEntry(page, { amount: '200', symbol: 'AAPL', tag: 'breakout' });
  await addEntry(page, { amount: '75.5', loss: true });
  const axe = () => new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  for (const tab of ['calendar', 'trades', 'analytics', 'accounts'] as const) {
    await gotoTab(page, tab);
    await page.waitForTimeout(150);
    const r = await axe().include(`#screen-${tab}`).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`), tab).toEqual([]);
  }
  const nav = await axe().include('nav').analyze();
  expect(nav.violations.map((v) => v.id)).toEqual([]);
  await openQuickAdd(page);
  await page.getByTestId('qa-more').click();
  await page.waitForTimeout(400); // let the fade-in finish so contrast is measured at rest
  const sheet = await axe().include('[role=dialog]').analyze();
  expect(sheet.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);
  // background is hidden from assistive tech while the sheet is open
  await expect(page.locator('#root')).toHaveAttribute('inert', '');
  await page.keyboard.press('Escape');
  await expect(page.locator('#root')).not.toHaveAttribute('inert', '');

  // Profit/loss is never colour-only: signed text and spoken labels
  await gotoTab(page, 'calendar');
  const today = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const cell = page.getByTestId(`day-${today}`);
  await expect(cell).toHaveAccessibleName(/November 6.*\+\$124\.50, 2 trades/);
  await expect(cell).toHaveAttribute('aria-current', 'date');
  await expect(cell).toContainText('+$125');
});
