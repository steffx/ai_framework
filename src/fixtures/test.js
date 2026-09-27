import { test as base, expect } from '@playwright/test';
import { BankApi } from '../api/BankApi.js';
import { LoginPage } from '../pages/LoginPage.js';
import { DashboardPage } from '../pages/DashboardPage.js';
import { TransferPage } from '../pages/TransferPage.js';
import { TransactionsPage } from '../pages/TransactionsPage.js';
import { CardPage } from '../pages/CardPage.js';

/**
 * Custom fixtures.
 *
 *  customerAccount  option: starting balances, override with test.use({ customerAccount: {...} })
 *  customer         a brand-new customer created through the API for this test only
 *  signedIn         the browser context is logged in as `customer` (API login, no UI clicks)
 *  customerApi      API client that shares the browser's session cookie, for fast test setup
 *  *Page            page objects
 */
export const test = base.extend({
  customerAccount: [{ checking: 2500, savings: 10000 }, { option: true }],

  bankApi: async ({ request }, use) => {
    await use(new BankApi(request));
  },

  customer: async ({ bankApi, customerAccount }, use) => {
    await use(await bankApi.createCustomer(customerAccount));
  },

  signedIn: async ({ page, customer }, use) => {
    const response = await page.request.post('/api/login', { data: customer });
    expect(response.ok(), 'API login for test customer').toBeTruthy();
    await use(customer);
  },

  customerApi: async ({ page, signedIn }, use) => {
    await use(new BankApi(page.request));
  },

  loginPage: async ({ page }, use) => use(new LoginPage(page)),
  dashboardPage: async ({ page }, use) => use(new DashboardPage(page)),
  transferPage: async ({ page }, use) => use(new TransferPage(page)),
  transactionsPage: async ({ page }, use) => use(new TransactionsPage(page)),
  cardPage: async ({ page }, use) => use(new CardPage(page)),
});

export { expect };
