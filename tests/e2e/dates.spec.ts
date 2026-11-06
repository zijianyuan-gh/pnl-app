import { expect, test } from '@playwright/test';
import { addEntry, createAccount, freshApp, gotoTab, openQuickAdd } from './helpers';

// One instant right at the year boundary, viewed from four very different timezones.
const INSTANT = new Date('2026-12-31T23:30:00Z');
const ZONES = ['Pacific/Kiritimati', 'Asia/Shanghai', 'America/Los_Angeles', 'Pacific/Pago_Pago'];

const localDate = (tz: string, d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d); // YYYY-MM-DD

for (const tz of ZONES) {
  test.describe(`Scenario D — dates in ${tz}`, () => {
    test.use({ timezoneId: tz });

    test('default date is the local day; explicit dates never shift', async ({ page }, info) => {
      test.skip(info.project.name === 'desktop-chromium', 'timezone logic is device-independent; run once');
      await page.clock.setFixedTime(INSTANT);
      await freshApp(page);
      const today = localDate(tz, INSTANT);
      await createAccount(page, 'Main', '1000', '2020-01-01');

      // Quick add defaults to the *local* calendar date
      await openQuickAdd(page);
      await expect(page.getByTestId('qa-date')).toHaveValue(today);
      await page.keyboard.press('Escape');

      await addEntry(page, { amount: '10' }); // today
      for (const [date, amount] of [
        ['2024-02-29', '29'],
        ['2026-01-31', '31'],
        ['2026-02-01', '1'],
        ['2026-03-08', '8'], // US DST start
        ['2026-11-01', '11'], // US DST end
        ['2026-12-31', '1231'],
        ['2027-01-01', '101'],
      ] as const) {
        await addEntry(page, { amount, date });
      }

      await page.reload();
      await gotoTab(page, 'calendar');
      const cell = (d: string) => page.getByTestId(`day-${d}`);
      // today's cell holds today's +10 plus whatever was explicitly booked that day
      const extra = today === '2026-12-31' ? 123100 : today === '2027-01-01' ? 10100 : 0;
      await expect(cell(today)).toHaveAttribute('data-pnl', String(1000 + extra));

      // walk to Dec 2026 / Jan 2027 and check both sides of the year boundary
      const title = page.getByTestId('month-title');
      if ((await title.textContent())?.includes('2027')) await page.getByTestId('prev-month').click();
      await expect(title).toHaveText('December 2026');
      await expect(cell('2026-12-31')).toHaveAttribute('data-pnl', String(123100 + (today === '2026-12-31' ? 1000 : 0)));
      await expect(cell('2026-12-30')).not.toHaveAttribute('data-pnl', /.*/);
      await page.getByTestId('next-month').click();
      await expect(title).toHaveText('January 2027');
      await expect(cell('2027-01-01')).toHaveAttribute('data-pnl', String(10100 + (today === '2027-01-01' ? 1000 : 0)));
      await expect(cell('2027-01-02')).not.toHaveAttribute('data-pnl', /.*/);

      // November: DST end, 30 days
      for (let i = 0; i < 2; i++) await page.getByTestId('prev-month').click();
      await expect(title).toHaveText('November 2026');
      await expect(cell('2026-11-01')).toHaveAttribute('data-pnl', '1100');
      await expect(cell('2026-10-31')).toHaveCount(0);
      await expect(page.locator('[data-testid^=day-2026-11-]')).toHaveCount(30);

      // walk back to Jan/Feb/Mar 2026 (month lengths + DST start)
      for (let i = 0; i < 8; i++) await page.getByTestId('prev-month').click();
      await expect(title).toHaveText('March 2026');
      await expect(cell('2026-03-08')).toHaveAttribute('data-pnl', '800');
      await expect(cell('2026-03-07')).not.toHaveAttribute('data-pnl', /.*/);
      await page.getByTestId('prev-month').click();
      await expect(page.locator('[data-testid^=day-2026-02-]')).toHaveCount(28);
      await expect(cell('2026-02-01')).toHaveAttribute('data-pnl', '100');
      await page.getByTestId('prev-month').click();
      await expect(cell('2026-01-31')).toHaveAttribute('data-pnl', '3100');
      await expect(page.locator('[data-testid^=day-2026-01-]')).toHaveCount(31);

      // Trades list groups show the exact calendar dates
      await gotoTab(page, 'trades');
      const groups = page.locator('#screen-trades [data-testid=trade-group] h2');
      await expect(groups).toContainText(['Thu, Feb 29, 2024']);
      await expect(page.locator('#screen-trades')).toContainText('Fri, Jan 1, 2027');
      await expect(page.locator('#screen-trades')).toContainText('Thu, Dec 31, 2026');
      await expect(page.locator('#screen-trades')).toContainText('Sat, Jan 31, 2026');
    });
  });
}
