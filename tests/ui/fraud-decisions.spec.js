import fs from 'node:fs';
import { test, expect } from '../../src/fixtures/test.js';
import { KNOWN_PAYEE, newIban } from '../../src/data/ibans.js';

/**
 * Data-driven end-to-end checks of the fraud engine through the UI.
 * Every scenario marked "ui": true in test-data/fraud-scenarios.json is replayed
 * as a real customer journey and must end in the decision the rules predict.
 */
const { scenarios } = JSON.parse(fs.readFileSync(new URL('../../test-data/fraud-scenarios.json', import.meta.url)));
const SEED_AMOUNT = 1;
const PAST_TENSE = { APPROVE: 'approved', REVIEW: 'sent for step-up verification', BLOCK: 'blocked' };

for (const scenario of scenarios.filter((s) => s.ui)) {
  const { context } = scenario;

  test.describe(`${scenario.id}: ${scenario.title}`, () => {
    // Top up by the small payments used to simulate velocity, so the balance at decision time matches the scenario.
    test.use({
      customerAccount: { checking: context.balance + context.recentTransferCount * SEED_AMOUNT, savings: 0 },
    });

    test(`is ${PAST_TENSE[scenario.expectedDecision]} in the UI`, { tag: '@fraud' }, async ({
      customerApi,
      transferPage,
    }) => {
      if (!context.isNewPayee && context.country !== 'DE') {
        throw new Error(`${scenario.id}: the only known payee is German, fix the scenario data`);
      }
      for (let i = 0; i < context.recentTransferCount; i++) {
        const res = await customerApi.transfer({ recipientName: KNOWN_PAYEE.name, recipientIban: KNOWN_PAYEE.iban, amount: SEED_AMOUNT });
        expect(res.ok()).toBeTruthy();
      }

      await transferPage.goto();
      await transferPage.send({
        recipientName: scenario.recipientName,
        recipientIban: context.isNewPayee ? newIban(context.country) : KNOWN_PAYEE.iban,
        amount: String(context.amount),
        reference: context.description,
      });

      switch (scenario.expectedDecision) {
        case 'APPROVE':
          await expect(transferPage.success).toBeVisible();
          break;
        case 'REVIEW':
          await expect(transferPage.otpPanel).toBeVisible();
          await expect(transferPage.otpPanel).toContainText('This payment needs extra verification');
          break;
        case 'BLOCK':
          await expect(transferPage.blocked).toBeVisible();
          await expect(transferPage.blocked).toContainText('No money has left your account');
          await expect(transferPage.riskReasons.first()).toBeVisible();
          break;
        default:
          throw new Error(`Unknown decision ${scenario.expectedDecision}`);
      }
    });
  });
}

test.describe('Blocked payment explanation', () => {
  test('lists every risk signal that fired, in plain language', { tag: ['@fraud', '@mobile'] }, async ({
    signedIn,
    transferPage,
    dashboardPage,
  }) => {
    await transferPage.goto();
    await transferPage.send({
      recipientName: 'Crypto Gains Ltd',
      recipientIban: newIban('IR'),
      amount: '1500',
      reference: 'crypto investment opportunity',
    });

    await expect(transferPage.blocked).toBeVisible();
    await expect(transferPage.riskReasons).toHaveText([
      'Recipient bank is in a high-risk jurisdiction',
      'First payment to this recipient',
      'Payment reference contains scam-related keywords',
    ]);
    expect(await transferPage.riskReasons.evaluateAll((els) => els.map((e) => e.dataset.code))).toEqual([
      'HIGH_RISK_COUNTRY',
      'NEW_PAYEE',
      'SUSPICIOUS_DESCRIPTION',
    ]);

    // A blocked payment must not move money.
    await dashboardPage.goto();
    expect(await dashboardPage.balanceOf('Checking')).toBe(2500);
  });
});

test.describe('Known payees', () => {
  test.use({ customerAccount: { checking: 10000, savings: 0 } });

  test('a payee becomes "known" after the first successful payment', { tag: '@fraud' }, async ({
    signedIn,
    transferPage,
    customerApi,
  }) => {
    const iban = newIban('DE');
    // 3,000 to a new payee = LARGE_AMOUNT (25) + NEW_PAYEE (15) = 40 -> review.
    // Pay a small amount first so the payee is no longer new: 25 -> approve.
    const first = await customerApi.transfer({ recipientName: 'Autohaus Weber', recipientIban: iban, amount: 10 });
    expect((await first.json()).status).toBe('COMPLETED');

    await transferPage.goto();
    await transferPage.send({ recipientName: 'Autohaus Weber', recipientIban: iban, amount: '3000' });
    await expect(transferPage.success).toBeVisible();
  });
});
