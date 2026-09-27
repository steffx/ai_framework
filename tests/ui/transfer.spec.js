import { test, expect } from '../../src/fixtures/test.js';
import { KNOWN_PAYEE, newIban, withBrokenChecksum, groupIban } from '../../src/data/ibans.js';

test.describe('Send money', () => {
  test('pays a known payee and the new balance is shown everywhere', { tag: ['@smoke', '@mobile'] }, async ({
    signedIn,
    transferPage,
    dashboardPage,
  }) => {
    await transferPage.goto();
    await transferPage.send({
      recipientName: KNOWN_PAYEE.name,
      recipientIban: KNOWN_PAYEE.iban,
      amount: '100.50',
      reference: 'Cleaning',
    });

    await expect(transferPage.success).toBeVisible();
    await expect(transferPage.success).toContainText('€100.50 is on its way to Harbor Lettings Ltd.');
    await expect(transferPage.newBalance).toHaveText('€2,399.50');

    await dashboardPage.goto();
    expect(await dashboardPage.balanceOf('Checking')).toBe(2399.5);
    await expect(dashboardPage.recentTransactions.first()).toContainText('Harbor Lettings Ltd');
  });

  test('pays from the savings account when selected', async ({ signedIn, transferPage, dashboardPage }) => {
    await transferPage.goto();
    await transferPage.send({ from: 'Savings', recipientName: KNOWN_PAYEE.name, recipientIban: KNOWN_PAYEE.iban, amount: 250 });

    await expect(transferPage.newBalance).toHaveText('€9,750.00');
    await dashboardPage.goto();
    expect(await dashboardPage.balanceOf('Checking')).toBe(2500);
    expect(await dashboardPage.balanceOf('Savings')).toBe(9750);
  });

  // Data-driven negative tests: each row is one invalid input and the message the customer should see.
  const invalidInputs = [
    { case: 'missing recipient name', details: { recipientName: '' }, field: 'recipientName', message: 'Recipient name is required' },
    { case: 'missing IBAN', details: { recipientIban: '' }, field: 'recipientIban', message: 'IBAN is required' },
    { case: 'IBAN with wrong checksum', details: { recipientIban: withBrokenChecksum(KNOWN_PAYEE.iban) }, field: 'recipientIban', message: 'Enter a valid IBAN' },
    { case: 'IBAN too short', details: { recipientIban: 'DE8937' }, field: 'recipientIban', message: 'Enter a valid IBAN' },
    { case: 'missing amount', details: { amount: '' }, field: 'amount', message: 'Amount is required' },
    { case: 'zero amount', details: { amount: '0' }, field: 'amount', message: 'Amount must be greater than zero' },
    { case: 'three decimals', details: { amount: '10.999' }, field: 'amount', message: 'Enter an amount with up to 2 decimals' },
    { case: 'negative amount', details: { amount: '-50' }, field: 'amount', message: 'Enter an amount with up to 2 decimals' },
    { case: 'letters in amount', details: { amount: 'ten' }, field: 'amount', message: 'Enter an amount with up to 2 decimals' },
  ];
  for (const { case: name, details, field, message } of invalidInputs) {
    test(`rejects ${name}`, async ({ signedIn, transferPage }) => {
      await transferPage.goto();
      await transferPage.submitDetails({
        recipientName: KNOWN_PAYEE.name,
        recipientIban: KNOWN_PAYEE.iban,
        amount: '10',
        ...details,
      });

      await expect(transferPage.fieldError(field)).toHaveText(message);
      await expect(transferPage.page.getByLabel(labelFor(field))).toHaveAttribute('aria-invalid', 'true');
      await expect(transferPage.reviewStep).toBeHidden();
    });
  }

  test('accepts a comma as decimal separator', async ({ signedIn, transferPage }) => {
    await transferPage.goto();
    await transferPage.submitDetails({ recipientName: KNOWN_PAYEE.name, recipientIban: KNOWN_PAYEE.iban, amount: '12,34' });
    await expect(transferPage.reviewAmount).toHaveText('€12.34');
  });

  test('groups the IBAN in blocks of four when the field loses focus', async ({ signedIn, transferPage }) => {
    await transferPage.goto();
    await transferPage.recipientIban.fill('de89370400440532013000');
    await transferPage.amount.focus();

    await expect(transferPage.recipientIban).toHaveValue('DE89 3704 0044 0532 0130 00');
  });

  test('reference field counts characters and stops at 140', async ({ signedIn, transferPage }) => {
    await transferPage.goto();
    await transferPage.reference.pressSequentially('Invoice 42');
    await expect(transferPage.referenceCounter).toHaveText('10/140');

    await transferPage.reference.fill('x'.repeat(200));
    await expect(transferPage.reference).toHaveValue('x'.repeat(140));
  });

  test('review step shows exactly what was entered and Edit keeps the values', async ({ signedIn, transferPage }) => {
    const iban = newIban('NL');
    await transferPage.goto();
    await transferPage.submitDetails({ recipientName: 'Sanne de Vries', recipientIban: iban, amount: '75', reference: 'Tickets' });

    await expect(transferPage.progressStep).toHaveText('2. Review');
    await expect(transferPage.reviewFrom).toHaveText('Checking');
    await expect(transferPage.reviewName).toHaveText('Sanne de Vries');
    await expect(transferPage.reviewIban).toHaveText(groupIban(iban));
    await expect(transferPage.reviewAmount).toHaveText('€75.00');
    await expect(transferPage.reviewReference).toHaveText('Tickets');

    await transferPage.editButton.click();
    await expect(transferPage.progressStep).toHaveText('1. Details');
    await expect(transferPage.recipientName).toHaveValue('Sanne de Vries');
    await expect(transferPage.amount).toHaveValue('75');
  });

  test('shows a scam warning before the customer confirms', async ({ signedIn, transferPage }) => {
    await transferPage.goto();
    await transferPage.submitDetails({ recipientName: KNOWN_PAYEE.name, recipientIban: KNOWN_PAYEE.iban, amount: '10' });
    await expect(transferPage.reviewStep).toContainText('never ask you to move money to a "safe account"');
  });

  test('insufficient funds is reported on the amount field and nothing is paid', async ({
    signedIn,
    transferPage,
    dashboardPage,
  }) => {
    await transferPage.goto();
    await transferPage.send({ recipientName: KNOWN_PAYEE.name, recipientIban: KNOWN_PAYEE.iban, amount: '2500.01' });

    await expect(transferPage.detailsStep).toBeVisible();
    await expect(transferPage.fieldError('amount')).toHaveText('Insufficient funds in the selected account');

    await dashboardPage.goto();
    expect(await dashboardPage.balanceOf('Checking')).toBe(2500);
  });

  test.describe('with a large balance', () => {
    test.use({ customerAccount: { checking: 100000, savings: 0 } });

    test('rejects amounts above the single transfer limit', async ({ signedIn, transferPage }) => {
      await transferPage.goto();
      await transferPage.send({ recipientName: KNOWN_PAYEE.name, recipientIban: KNOWN_PAYEE.iban, amount: '50000.01' });
      await expect(transferPage.fieldError('amount')).toHaveText('Amount exceeds the single transfer limit of €50,000.00');
    });
  });

  test('a frozen card blocks outgoing payments', async ({ customerApi, transferPage }) => {
    await customerApi.setCardFrozen(true);

    await transferPage.goto();
    await transferPage.send({ recipientName: KNOWN_PAYEE.name, recipientIban: KNOWN_PAYEE.iban, amount: '10' });

    await expect(transferPage.formError).toHaveText(
      'Payments are frozen. Unfreeze your card in Card & security to send money.',
    );
    await expect(transferPage.success).toBeHidden();
  });

  test('the confirm button is disabled while the payment is being sent (no double payments)', async ({
    page,
    signedIn,
    transferPage,
  }) => {
    // Slow the API down so the in-flight state is observable.
    await page.route('**/api/transfers', async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      await route.continue();
    });
    await transferPage.goto();
    await transferPage.submitDetails({ recipientName: KNOWN_PAYEE.name, recipientIban: KNOWN_PAYEE.iban, amount: '5' });
    await transferPage.confirmButton.click();

    await expect(transferPage.confirmButton).toBeDisabled();
    await expect(transferPage.confirmButton).toHaveText('Sending…');
    await expect(transferPage.success).toBeVisible();
  });

  test('a server error does not show a false success', async ({ page, signedIn, transferPage }) => {
    await page.route('**/api/transfers', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Payment service unavailable' }) }),
    );
    await transferPage.goto();
    await transferPage.send({ recipientName: KNOWN_PAYEE.name, recipientIban: KNOWN_PAYEE.iban, amount: '5' });

    await expect(transferPage.formError).toHaveText('Payment service unavailable');
    await expect(transferPage.success).toBeHidden();
  });
});

function labelFor(field) {
  return { recipientName: 'Recipient name', recipientIban: 'Recipient IBAN', amount: 'Amount (EUR)' }[field];
}
