import { test, expect } from '../../src/fixtures/test.js';
import { newIban } from '../../src/data/ibans.js';

// €3,000 to a new payee scores 40 (LARGE_AMOUNT 25 + NEW_PAYEE 15): the customer must confirm with a one-time code.
const RISKY_PAYMENT = { recipientName: 'Autohaus Weber', amount: '3000', reference: 'Car purchase' };

test.describe('Step-up verification (one-time code)', () => {
  test.use({ customerAccount: { checking: 5000, savings: 0 } });

  test('correct code completes the payment', { tag: ['@smoke', '@mobile'] }, async ({
    signedIn,
    transferPage,
    bankApi,
  }) => {
    await transferPage.goto();
    const transferId = await transferPage.sendAndCaptureTransferId({ ...RISKY_PAYMENT, recipientIban: newIban('DE') });
    await expect(transferPage.otpPanel).toBeVisible();
    await expect(transferPage.otpInput).toBeFocused();

    // Read the code from the simulated SMS inbox.
    const code = await bankApi.otpFor(transferId);
    await transferPage.enterOtp(code);

    await expect(transferPage.success).toBeVisible();
    await expect(transferPage.newBalance).toHaveText('€2,000.00');
  });

  test('wrong code shows how many attempts are left', async ({ signedIn, transferPage, bankApi }) => {
    await transferPage.goto();
    const transferId = await transferPage.sendAndCaptureTransferId({ ...RISKY_PAYMENT, recipientIban: newIban('DE') });
    const wrong = wrongCode(await bankApi.otpFor(transferId));

    await transferPage.enterOtp(wrong);
    await expect(transferPage.otpError).toHaveText('Incorrect code. 2 attempts left.');
    await expect(transferPage.otpInput).toHaveValue('');

    await transferPage.enterOtp(wrong);
    await expect(transferPage.otpError).toHaveText('Incorrect code. 1 attempt left.');
  });

  test('three wrong codes cancel the payment and no money moves', async ({
    signedIn,
    transferPage,
    bankApi,
    transactionsPage,
    dashboardPage,
  }) => {
    await transferPage.goto();
    const transferId = await transferPage.sendAndCaptureTransferId({ ...RISKY_PAYMENT, recipientIban: newIban('DE') });
    const wrong = wrongCode(await bankApi.otpFor(transferId));

    for (let i = 0; i < 3; i++) await transferPage.enterOtp(wrong);

    await expect(transferPage.cancelled).toBeVisible();
    await expect(transferPage.cancelled).toContainText('Too many incorrect codes. The payment was cancelled.');

    await transactionsPage.goto();
    await expect(transactionsPage.row('Autohaus Weber').getByTestId('tx-status')).toHaveText('CANCELLED');

    await dashboardPage.goto();
    expect(await dashboardPage.balanceOf('Checking')).toBe(5000);
  });

  const malformedCodes = ['', '123', 'abcdef', '12 456'];
  for (const code of malformedCodes) {
    test(`malformed code "${code}" is rejected before calling the server`, async ({ page, signedIn, transferPage }) => {
      await transferPage.goto();
      await transferPage.sendAndCaptureTransferId({ ...RISKY_PAYMENT, recipientIban: newIban('DE') });

      let otpCalls = 0;
      page.on('request', (r) => r.url().includes('/otp') && otpCalls++);
      await transferPage.enterOtp(code);

      await expect(transferPage.otpError).toHaveText('Enter the 6-digit code');
      expect(otpCalls).toBe(0);
    });
  }

  test('rapid repeated payments trigger verification (velocity rule)', async ({ signedIn, customerApi, transferPage }) => {
    // Three small payments in quick succession...
    for (let i = 0; i < 3; i++) {
      const res = await customerApi.transfer({ recipientName: 'Harbor Lettings Ltd', recipientIban: 'DE89370400440532013000', amount: 5 });
      expect((await res.json()).status).toBe('COMPLETED');
    }
    // ...then a small payment to a new payee: HIGH_VELOCITY 30 + NEW_PAYEE 15 = 45 -> review.
    await transferPage.goto();
    await transferPage.send({ recipientName: 'Quick Transfer', recipientIban: newIban('NL'), amount: '50' });

    await expect(transferPage.otpPanel).toBeVisible();
  });
});

function wrongCode(correct) {
  return String((Number(correct) + 1) % 1_000_000).padStart(6, '0');
}
