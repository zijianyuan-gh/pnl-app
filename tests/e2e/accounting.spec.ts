import { expect, test } from '@playwright/test';
import { MINUS, addEntry, browserToday, createAccount, freshApp, gotoTab, setAccountFilter } from './helpers';

async function scenarioA(page: import('@playwright/test').Page) {
  await freshApp(page);
  await createAccount(page, 'A', '1000');
  await createAccount(page, 'B', '2000');
  await addEntry(page, { account: 'A', amount: '200', symbol: 'AAPL' });
  await addEntry(page, { account: 'A', amount: '50', loss: true });
  await addEntry(page, { account: 'B', amount: '20' });
  await addEntry(page, { account: 'A', amount: '500', kind: 'deposit' });
}

test('Scenario A — basic accounting through the UI', async ({ page }) => {
  await scenarioA(page);
  const today = await browserToday(page);

  // Calendar header: all accounts
  await gotoTab(page, 'calendar');
  await expect(page.getByTestId('header-balance')).toHaveText('$3,670.00');
  await expect(page.getByTestId('header-month-pnl')).toHaveText('+$170.00');
  const cell = page.getByTestId(`day-${today}`);
  await expect(cell).toHaveAttribute('data-pnl', '17000');
  await expect(cell).toContainText('3 trades');
  await expect(page.getByTestId('month-summary')).toContainText('3 trades');

  // Per-account
  await setAccountFilter(page, 'A');
  await expect(page.getByTestId('header-balance')).toHaveText('$1,650.00');
  await expect(page.getByTestId('header-month-pnl')).toHaveText('+$150.00');
  await setAccountFilter(page, 'B');
  await expect(page.getByTestId('header-balance')).toHaveText('$2,020.00');
  await expect(page.getByTestId('header-month-pnl')).toHaveText('+$20.00');
  await setAccountFilter(page, null);

  // Analytics: deposit does not count as a trade, P&L or win
  await gotoTab(page, 'analytics');
  await expect(page.getByTestId('an-net')).toHaveText('+$170.00');
  await expect(page.getByTestId('an-alltime')).toHaveText('+$170.00');
  await expect(page.locator('#screen-analytics')).toContainText('3 trades · 1 trading day');
  await expect(page.getByTestId('an-trade-winrate-value')).toHaveText('66.7%');
  await expect(page.getByTestId('an-trade-winrate')).toContainText('2 wins · 1 loss');
  await expect(page.getByTestId('an-day-winrate-value')).toHaveText('100%');
  await expect(page.getByTestId('an-avg-win-value')).toHaveText('+$110.00');
  await expect(page.getByTestId('an-avg-loss-value')).toHaveText(`${MINUS}$50.00`);

  // Trades list: 3 trades, net +170; transfers tab shows the deposit
  await gotoTab(page, 'trades');
  await expect(page.getByTestId('trades-summary')).toHaveText('3 trades · Net +$170.00');
  await expect(page.locator('#screen-trades [data-testid=trade-row]')).toHaveCount(3);
  await page.locator('#screen-trades').getByRole('radio', { name: 'Transfers' }).click();
  await expect(page.getByTestId('trades-summary')).toHaveText('1 transfer · Net +$500.00');

  // Accounts
  await gotoTab(page, 'accounts');
  await expect(page.getByTestId('total-balance')).toHaveText('$3,670.00');
  await expect(page.getByTestId('account-row-A')).toContainText('$1,650.00');
  await expect(page.getByTestId('account-row-A')).toContainText('+$150.00');
  await expect(page.getByTestId('account-row-B')).toContainText('$2,020.00');
  await page.getByTestId('account-row-A').click();
  await expect(page.getByTestId('account-balance')).toHaveText('$1,650.00');
  await expect(page.getByTestId('account-pnl')).toHaveText('+$150.00');
});

test('Scenario B — edits and deletes update every view; undo restores', async ({ page }) => {
  await scenarioA(page);
  const today = await browserToday(page);
  await gotoTab(page, 'calendar');
  await page.getByTestId(`day-${today}`).click();

  // Edit the +200 trade to +300
  await page.locator('#screen-calendar [data-testid=trade-row]', { hasText: 'AAPL' }).click();
  const qa = page.getByTestId('quick-add');
  await expect(qa.getByTestId('qa-amount')).toHaveValue('200');
  await qa.getByTestId('qa-amount').fill('300');
  await qa.getByTestId('qa-save').click();
  await expect(qa).toBeHidden();

  await expect(page.getByTestId('header-balance')).toHaveText('$3,770.00');
  await expect(page.getByTestId('header-month-pnl')).toHaveText('+$270.00');
  await expect(page.getByTestId(`day-${today}`)).toHaveAttribute('data-pnl', '27000');
  await expect(page.getByTestId('day-net')).toHaveText('+$270.00');
  await gotoTab(page, 'analytics');
  await expect(page.getByTestId('an-net')).toHaveText('+$270.00');
  await page.getByRole('button', { name: 'Show as table' }).click();
  await expect(page.getByTestId('monthly-table')).toContainText('+$270.00');
  await gotoTab(page, 'accounts');
  await expect(page.getByTestId('account-row-A')).toContainText('$1,750.00');

  // Flip a profit into a loss: the sign is chosen explicitly
  await gotoTab(page, 'trades');
  await page.locator('#screen-trades [data-testid=trade-row]', { hasText: 'AAPL' }).click();
  await qa.getByTestId('sign-loss').click();
  await qa.getByTestId('qa-save').click();
  await gotoTab(page, 'calendar');
  await expect(page.getByTestId('header-month-pnl')).toHaveText(`${MINUS}$330.00`);
  // undo via toast
  await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('header-month-pnl')).toHaveText('+$270.00');

  // Delete the AAPL trade
  await page.locator('#screen-calendar [data-testid=trade-row]', { hasText: 'AAPL' }).click();
  await qa.getByTestId('qa-delete').click();
  await page.getByTestId('confirm-ok').click();
  await expect(qa).toBeHidden();
  await expect(page.getByTestId('header-month-pnl')).toHaveText(`${MINUS}$30.00`);
  await expect(page.getByTestId('header-balance')).toHaveText('$3,470.00');
  await expect(page.getByTestId(`day-${today}`)).toHaveAttribute('data-pnl', '-3000');
  await expect(page.locator('#screen-calendar [data-testid=trade-row]')).toHaveCount(2);
  await gotoTab(page, 'analytics');
  await expect(page.getByTestId('an-net')).toHaveText(`${MINUS}$30.00`);
  await expect(page.getByTestId('an-trade-winrate-value')).toHaveText('50.0%');

  // Undo the delete
  await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('an-net')).toHaveText('+$270.00');

  // Delete the last trade of a day leaves no stale cell
  await gotoTab(page, 'trades');
  for (let i = 0; i < 3; i++) {
    await page.locator('#screen-trades [data-testid=trade-row]').first().click();
    await qa.getByTestId('qa-delete').click();
    await page.getByTestId('confirm-ok').click();
    await expect(qa).toBeHidden();
  }
  await gotoTab(page, 'calendar');
  await expect(page.getByTestId(`day-${today}`)).not.toHaveAttribute('data-pnl', /.*/);
  await expect(page.getByTestId('header-month-pnl')).toHaveText('$0.00');
  await expect(page.getByTestId('header-balance')).toHaveText('$3,500.00'); // 1000 + 2000 + 500 deposit
});

test('Quick add: continuous entry, validation, fees note, typed minus switches to loss', async ({ page }) => {
  await freshApp(page);
  await createAccount(page, 'Futures', '5000');
  await page.getByTestId('tab-add').click();
  const qa = page.getByTestId('quick-add');
  // empty amount → inline error, not saved
  await qa.getByTestId('qa-save').click();
  await expect(qa).toContainText('Enter an amount like 125.50');
  await qa.getByTestId('qa-amount').fill('-45.5');
  await expect(qa.getByTestId('sign-loss')).toHaveAttribute('aria-checked', 'true');
  await expect(qa.getByTestId('qa-amount')).toHaveValue('45.5');
  await expect(qa).toContainText(`Net realized P&L: ${MINUS}$45.50`);
  await qa.getByTestId('qa-more').click();
  await qa.getByTestId('qa-fees').fill('2.10');
  await expect(qa).toContainText('already included in the net P&L');
  await qa.getByTestId('qa-save-next').click();
  // sheet stays open, amount cleared, ready for next
  await expect(qa).toBeVisible();
  await expect(qa.getByTestId('qa-amount')).toHaveValue('');
  await qa.getByTestId('qa-amount').fill('100');
  await qa.getByTestId('sign-profit').click();
  await qa.getByTestId('qa-save').click();
  await expect(qa).toBeHidden();
  // fees are NOT deducted again
  await expect(page.getByTestId('header-month-pnl')).toHaveText('+$54.50');
  await expect(page.getByTestId('header-balance')).toHaveText('$5,054.50');
});

test('Deleting an account requires typing its name; erase all requires ERASE', async ({ page }) => {
  await freshApp(page);
  await createAccount(page, 'Temp', '100');
  await addEntry(page, { account: 'Temp', amount: '10' });
  await gotoTab(page, 'accounts');
  await page.getByTestId('account-row-Temp').click();
  await page.getByTestId('account-delete').click();
  await expect(page.getByTestId('confirm-ok')).toBeDisabled();
  await page.getByTestId('confirm-input').fill('temp');
  await expect(page.getByTestId('confirm-ok')).toBeDisabled();
  await page.getByTestId('confirm-input').fill('Temp');
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByTestId('account-row-Temp')).toHaveCount(0);
  await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('account-row-Temp')).toBeVisible();
  await expect(page.getByTestId('total-balance')).toHaveText('$110.00');

  await page.getByTestId('erase-all').click();
  await page.getByTestId('confirm-cancel').click();
  await expect(page.getByTestId('account-row-Temp')).toBeVisible();
  await page.getByTestId('erase-all').click();
  await page.getByTestId('confirm-input').fill('ERASE');
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByTestId('account-row-Temp')).toHaveCount(0);
});
