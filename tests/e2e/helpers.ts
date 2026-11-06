import { expect, type Page } from '@playwright/test';

export const MINUS = '−';

export async function freshApp(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('tab-calendar')).toBeVisible();
}

export async function gotoTab(page: Page, tab: 'calendar' | 'trades' | 'analytics' | 'accounts') {
  await page.getByTestId(`tab-${tab}`).click();
  await expect(page.locator(`#screen-${tab}`)).toBeVisible();
}

export async function createAccount(page: Page, name: string, balance: string, startDate?: string) {
  await gotoTab(page, 'accounts');
  await page.getByTestId('new-account').click();
  const form = page.getByTestId('account-form');
  await form.getByTestId('acc-name').fill(name);
  await form.getByTestId('acc-balance').fill(balance);
  if (startDate) await form.getByTestId('acc-date').fill(startDate);
  await form.getByTestId('acc-submit').click();
  await expect(page.getByTestId(`account-row-${name}`)).toBeVisible();
}

export interface TradeOpts {
  amount: string;
  loss?: boolean;
  account?: string;
  date?: string;
  symbol?: string;
  fees?: string;
  tag?: string;
  kind?: 'trade' | 'deposit' | 'withdrawal';
}

export async function openQuickAdd(page: Page) {
  await page.getByTestId('tab-add').click();
  await expect(page.getByTestId('quick-add')).toBeVisible();
}

export async function fillEntry(page: Page, o: TradeOpts) {
  const qa = page.getByTestId('quick-add');
  if (o.kind && o.kind !== 'trade') {
    await qa.getByRole('radio', { name: o.kind === 'deposit' ? 'Deposit' : 'Withdrawal' }).click();
  }
  if (o.account) await qa.getByTestId(`qa-account-${o.account}`).click();
  if (o.date) await qa.getByTestId('qa-date').fill(o.date);
  await qa.getByTestId('qa-amount').fill(o.amount);
  if (!o.kind || o.kind === 'trade') {
    await qa.getByTestId(o.loss ? 'sign-loss' : 'sign-profit').click();
    if (o.symbol || o.fees || o.tag) {
      if ((await qa.getByTestId('qa-symbol').count()) === 0) await qa.getByTestId('qa-more').click();
      if (o.symbol) await qa.getByTestId('qa-symbol').fill(o.symbol);
      if (o.fees) await qa.getByTestId('qa-fees').fill(o.fees);
      if (o.tag) {
        await qa.getByTestId('qa-tag').fill(o.tag);
        await qa.getByTestId('qa-tag').press('Enter');
      }
    }
  }
}

export async function addEntry(page: Page, o: TradeOpts) {
  await openQuickAdd(page);
  await fillEntry(page, o);
  await page.getByTestId('qa-save').click();
  await expect(page.getByTestId('quick-add')).toBeHidden();
}

export async function setAccountFilter(page: Page, name: string | null) {
  const screen = page.locator('main > div:not(.hidden)');
  await screen.getByTestId('account-filter').click();
  await page.getByRole('dialog').getByRole('button', { name: name ?? 'All accounts', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
}

/** Today's local date in the browser (respects the context timezone). */
export async function browserToday(page: Page): Promise<string> {
  return page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
}
