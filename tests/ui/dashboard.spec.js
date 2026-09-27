import { test, expect } from '../../src/fixtures/test.js';
import { newIban } from '../../src/data/ibans.js';

test.describe('Dashboard', () => {
  test.use({ customerAccount: { checking: 1234.56, savings: 10000 } });

  test('shows each account with its formatted balance', { tag: ['@smoke', '@mobile'] }, async ({
    signedIn,
    dashboardPage,
  }) => {
    await dashboardPage.goto();

    await expect(dashboardPage.accountCards).toHaveCount(2);
    await expect(dashboardPage.account('Checking').getByTestId('balance')).toHaveText('€1,234.56');
    await expect(dashboardPage.account('Savings').getByTestId('balance')).toHaveText('€10,000.00');
  });

  test('only masked account and card numbers are shown', async ({ page, signedIn, dashboardPage }) => {
    await dashboardPage.goto();

    for (const iban of await dashboardPage.accountCards.getByTestId('account-iban').allInnerTexts()) {
      expect(iban).toMatch(/^DE\d{2} \*{4} \*{4} \d{4}$/);
    }
    await expect(dashboardPage.cardNumber).toHaveText(/^\*{4} \*{4} \*{4} \d{4}$/);

    // No full 22-character German IBAN anywhere in the rendered page.
    expect(await page.content()).not.toMatch(/DE\d{20}/);
  });

  test('recent activity lists the latest transactions, newest first', async ({ signedIn, dashboardPage }) => {
    await dashboardPage.goto();

    await expect(dashboardPage.recentTransactions).toHaveCount(3);
    await expect(dashboardPage.recentTransactions.first()).toContainText('FreshMart Groceries');
    await expect(dashboardPage.recentTransactions.last()).toContainText('+€3,200.00');
  });

  const destinations = [
    { link: 'Send money', url: /\/transfer$/ },
    { link: 'Transactions', url: /\/transactions$/ },
    { link: 'Card & security', url: /\/card$/ },
  ];
  for (const { link, url } of destinations) {
    test(`header navigation to "${link}"`, { tag: '@mobile' }, async ({ page, signedIn, dashboardPage }) => {
      await dashboardPage.goto();
      await dashboardPage.header.navigateTo(link);

      await expect(page).toHaveURL(url);
      await expect(dashboardPage.header.currentLink).toHaveText(link);
    });
  }

  test('mobile menu is collapsed until the menu button is pressed', { tag: '@mobile' }, async ({
    signedIn,
    dashboardPage,
    isMobile,
  }) => {
    test.skip(!isMobile, 'The collapsed menu only exists on small screens');
    await dashboardPage.goto();

    await expect(dashboardPage.header.nav).toBeHidden();
    await dashboardPage.header.menuToggle.click();
    await expect(dashboardPage.header.menuToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(dashboardPage.header.nav).toBeVisible();
  });

  test('warns the customer after a payment was blocked', async ({ page, customerApi, dashboardPage }) => {
    const res = await customerApi.transfer({
      recipientName: 'Crypto Gains Ltd',
      recipientIban: newIban('IR'),
      amount: 500,
      description: 'crypto investment opportunity',
    });
    expect((await res.json()).status).toBe('BLOCKED');

    await dashboardPage.goto();
    await expect(dashboardPage.fraudAlertBanner).toHaveText(/We blocked 1 suspicious payment\./);
    await dashboardPage.fraudAlertBanner.getByRole('link', { name: 'Review security alerts' }).click();
    await expect(page).toHaveURL(/\/card$/);
  });

  test('no fraud banner for a customer without alerts', async ({ signedIn, dashboardPage }) => {
    await dashboardPage.goto();
    await expect(dashboardPage.fraudAlertBanner).toBeHidden();
  });
});
