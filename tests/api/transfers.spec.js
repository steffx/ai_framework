import { test, expect } from '../../src/fixtures/test.js';
import { KNOWN_PAYEE, newIban } from '../../src/data/ibans.js';

const SCAM_PAYMENT = {
  recipientName: 'Crypto Gains Ltd',
  amount: 1500,
  description: 'crypto investment opportunity',
};

test.describe('Transfers API', () => {
  test('requires authentication', async ({ request }) => {
    for (const [method, path] of [
      ['get', '/api/me'],
      ['get', '/api/transactions'],
      ['post', '/api/transfers'],
      ['post', '/api/card/freeze'],
      ['get', '/api/alerts'],
    ]) {
      const res = await request[method](path, method === 'post' ? { data: {} } : undefined);
      expect(res.status(), `${method.toUpperCase()} ${path}`).toBe(401);
    }
  });

  test('profile never exposes full IBANs or password data', { tag: '@smoke' }, async ({ newCustomerSession }) => {
    const api = await newCustomerSession();
    const raw = JSON.stringify(await api.me());

    expect(raw).not.toMatch(/DE\d{20}/);
    expect(raw).not.toMatch(/password/i);
    expect(raw).toMatch(/DE\d{2} \*{4} \*{4} \d{4}/);
  });

  test('returns every validation error at once', async ({ newCustomerSession }) => {
    const api = await newCustomerSession();
    const res = await api.transfer({ recipientName: '', recipientIban: 'XX00', amount: '1.001', description: 'x'.repeat(141) });

    expect(res.status()).toBe(400);
    expect((await res.json()).errors).toEqual({
      recipientName: 'Recipient name is required',
      recipientIban: 'Enter a valid IBAN',
      amount: 'Enter an amount with up to 2 decimals',
      description: 'Reference must be 140 characters or fewer',
    });
  });

  test('rejects paying from an account the customer does not own', async ({ newCustomerSession }) => {
    const alice = await newCustomerSession();
    const bob = await newCustomerSession();
    const bobsAccount = await bob.checkingAccount();

    const res = await alice.transfer({ recipientName: KNOWN_PAYEE.name, recipientIban: KNOWN_PAYEE.iban, amount: 10, fromAccountId: bobsAccount.id });
    expect(res.status()).toBe(400);
    expect((await res.json()).errors.fromAccountId).toBe('Select an account to pay from');
    expect((await bob.checkingAccount()).balance).toBe(2500);
  });

  test('approved payment debits the account and is recorded once', async ({ newCustomerSession }) => {
    const api = await newCustomerSession();
    const res = await api.transfer({ recipientName: KNOWN_PAYEE.name, recipientIban: KNOWN_PAYEE.iban, amount: '99.99' });
    const body = await res.json();

    expect(body).toMatchObject({ status: 'COMPLETED', riskScore: 0, balance: 2400.01 });
    const matching = (await api.transactions()).filter((t) => t.id === body.transactionId);
    expect(matching).toHaveLength(1);
    expect(matching[0]).toMatchObject({ status: 'COMPLETED', amount: 99.99, type: 'DEBIT' });
  });

  test('money is handled to the cent without floating point drift', async ({ newCustomerSession }) => {
    const api = await newCustomerSession({ checking: 1 });
    for (let i = 0; i < 10; i++) {
      const body = await (await api.transfer({ recipientName: KNOWN_PAYEE.name, recipientIban: KNOWN_PAYEE.iban, amount: '0.10' })).json();
      // The last payment empties the account while velocity is high, so the engine asks for a code.
      if (body.status === 'OTP_REQUIRED') {
        await api.confirmOtp(body.transactionId, await api.otpFor(body.transactionId));
      } else {
        expect(body.status).toBe('COMPLETED');
      }
    }
    // 1.00 - 10 x 0.10 must be exactly 0, not 1.3877787807814457e-16.
    expect((await api.checkingAccount()).balance).toBe(0);
  });

  test('blocked payment does not debit and raises one security alert', { tag: '@fraud' }, async ({ newCustomerSession }) => {
    const api = await newCustomerSession();
    const body = await (await api.transfer({ ...SCAM_PAYMENT, recipientIban: newIban('IR') })).json();

    expect(body.status).toBe('BLOCKED');
    expect(body.riskScore).toBe(75);
    expect((await api.checkingAccount()).balance).toBe(2500);
    const alerts = await api.alerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ transactionId: body.transactionId, status: 'OPEN' });
  });

  test('reporting an alert as fraud freezes the card', { tag: '@fraud' }, async ({ newCustomerSession }) => {
    const api = await newCustomerSession();
    await api.transfer({ ...SCAM_PAYMENT, recipientIban: newIban('IR') });
    const [alert] = await api.alerts();

    const res = await api.request.post(`/api/alerts/${alert.id}`, { data: { action: 'report' } });
    expect(await res.json()).toMatchObject({ alert: { status: 'CONFIRMED_FRAUD' }, cardFrozen: true });

    const next = await api.transfer({ recipientName: KNOWN_PAYEE.name, recipientIban: KNOWN_PAYEE.iban, amount: 1 });
    expect(next.status()).toBe(403);
  });
});

test.describe('Transfers API: step-up verification', () => {
  const REVIEW_PAYMENT = { recipientName: 'Autohaus Weber', amount: 3000, description: 'Car' };

  test('correct code completes the pending payment exactly once', async ({ newCustomerSession }) => {
    const api = await newCustomerSession({ checking: 5000 });
    const pending = await (await api.transfer({ ...REVIEW_PAYMENT, recipientIban: newIban('DE') })).json();
    expect(pending.status).toBe('OTP_REQUIRED');
    expect((await api.checkingAccount()).balance).toBe(5000);

    const code = await api.otpFor(pending.transactionId);
    const first = await api.confirmOtp(pending.transactionId, code);
    expect(await first.json()).toMatchObject({ status: 'COMPLETED', balance: 2000 });

    // Replaying the same code must not pay twice.
    const replay = await api.confirmOtp(pending.transactionId, code);
    expect(replay.status()).toBe(404);
    expect((await api.checkingAccount()).balance).toBe(2000);
  });

  test("a customer cannot confirm someone else's payment (IDOR)", async ({ newCustomerSession }) => {
    const victim = await newCustomerSession({ checking: 5000 });
    const attacker = await newCustomerSession();
    const pending = await (await victim.transfer({ ...REVIEW_PAYMENT, recipientIban: newIban('DE') })).json();
    const code = await victim.otpFor(pending.transactionId);

    const res = await attacker.confirmOtp(pending.transactionId, code);
    expect(res.status()).toBe(404);
    expect((await victim.checkingAccount()).balance).toBe(5000);
  });

  test('three wrong codes cancel the payment', async ({ newCustomerSession }) => {
    const api = await newCustomerSession({ checking: 5000 });
    const pending = await (await api.transfer({ ...REVIEW_PAYMENT, recipientIban: newIban('DE') })).json();

    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await api.confirmOtp(pending.transactionId, '000000x')).status());
    expect(statuses).toEqual([400, 400, 403]);

    const tx = (await api.transactions()).find((t) => t.id === pending.transactionId);
    expect(tx.status).toBe('CANCELLED');
    expect((await api.checkingAccount()).balance).toBe(5000);
  });
});

test.describe('Data isolation between customers', () => {
  test("a customer never sees another customer's transactions", async ({ newCustomerSession }) => {
    const alice = await newCustomerSession();
    const bob = await newCustomerSession();
    const payment = await (await alice.transfer({ recipientName: KNOWN_PAYEE.name, recipientIban: KNOWN_PAYEE.iban, amount: 12.34 })).json();

    const bobsIds = (await bob.transactions()).map((t) => t.id);
    expect(bobsIds).not.toContain(payment.transactionId);
  });
});
