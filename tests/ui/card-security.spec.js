import { test, expect } from '../../src/fixtures/test.js';
import { KNOWN_PAYEE, newIban } from '../../src/data/ibans.js';

test.describe('Card controls', () => {
  test('customer freezes and unfreezes the card', { tag: ['@smoke', '@mobile'] }, async ({
    signedIn,
    cardPage,
    page,
  }) => {
    await cardPage.goto();
    await expect(cardPage.freezeToggle).not.toBeChecked();
    await expect(cardPage.freezeStatus).toHaveText('Your card is active.');

    await cardPage.freezeToggle.click();
    await expect(cardPage.freezeToggle).toBeChecked();
    await expect(cardPage.toast).toHaveText('Card frozen');
    await expect(cardPage.freezeStatus).toContainText('Your card is frozen');
    await expect(cardPage.paymentCard).toHaveClass(/is-frozen/);

    // The state is stored server-side, not only in the page.
    await page.reload();
    await expect(cardPage.freezeToggle).toBeChecked();

    await cardPage.freezeToggle.click();
    await expect(cardPage.freezeToggle).not.toBeChecked();
    await expect(cardPage.toast).toHaveText('Card unfrozen');
  });

  test('frozen status is visible on the dashboard', async ({ customerApi, dashboardPage }) => {
    await customerApi.setCardFrozen(true);
    await dashboardPage.goto();
    await expect(dashboardPage.cardFrozenBadge).toHaveText('Frozen');
  });

  test('card number is masked', async ({ signedIn, cardPage }) => {
    await cardPage.goto();
    await expect(cardPage.cardNumber).toHaveText(/^\*{4} \*{4} \*{4} \d{4}$/);
  });

  test('shows a friendly message when there are no alerts', async ({ signedIn, cardPage }) => {
    await cardPage.goto();
    await expect(cardPage.noAlerts).toContainText('No security alerts');
  });
});

test.describe('Security alerts', () => {
  test.beforeEach(async ({ customerApi }) => {
    const res = await customerApi.transfer({
      recipientName: 'Crypto Gains Ltd',
      recipientIban: newIban('IR'),
      amount: 1500,
      description: 'crypto investment opportunity',
    });
    expect((await res.json()).status).toBe('BLOCKED');
  });

  test('a blocked payment creates an alert that needs review', async ({ cardPage }) => {
    await cardPage.goto();
    await expect(cardPage.alerts).toHaveCount(1);
    await expect(cardPage.alerts.first()).toContainText('We blocked a payment of €1,500.00 to Crypto Gains Ltd.');
    await expect(cardPage.alertStatus(cardPage.alerts.first())).toHaveText('Needs your review');
  });

  test('"This was me" marks the alert as genuine', async ({ cardPage }) => {
    await cardPage.goto();
    const alert = cardPage.alerts.first();
    await cardPage.dismissButton(alert).click();

    await expect(cardPage.toast).toHaveText('Thanks, we marked this payment as genuine');
    await expect(cardPage.alertStatus(alert)).toHaveText('Marked as genuine');
    await expect(cardPage.dismissButton(alert)).toHaveCount(0);
    await expect(cardPage.freezeToggle).not.toBeChecked();
  });

  test('reporting fraud freezes the card and stops further payments', { tag: '@mobile' }, async ({
    cardPage,
    transferPage,
  }) => {
    await cardPage.goto();
    const alert = cardPage.alerts.first();
    await cardPage.reportButton(alert).click();
    await expect(cardPage.reportDialog).toBeVisible();
    await cardPage.confirmReport.click();

    await expect(cardPage.reportDialog).toBeHidden();
    await expect(cardPage.toast).toHaveText('Fraud reported. Your card is now frozen.');
    await expect(cardPage.alertStatus(alert)).toHaveText('Reported as fraud');
    await expect(cardPage.freezeToggle).toBeChecked();

    await transferPage.goto();
    await transferPage.send({ recipientName: KNOWN_PAYEE.name, recipientIban: KNOWN_PAYEE.iban, amount: '10' });
    await expect(transferPage.formError).toContainText('Payments are frozen');
  });

  test('cancelling the report dialog changes nothing', async ({ cardPage }) => {
    await cardPage.goto();
    const alert = cardPage.alerts.first();
    await cardPage.reportButton(alert).click();
    await cardPage.cancelReport.click();

    await expect(cardPage.reportDialog).toBeHidden();
    await expect(cardPage.alertStatus(alert)).toHaveText('Needs your review');
    await expect(cardPage.freezeToggle).not.toBeChecked();
  });
});
