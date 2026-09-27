import fs from 'node:fs';
import { test, expect } from '../../src/fixtures/test.js';
import { baseContext, expectFraudScoreContract } from '../../src/utils/contracts.js';

const { scenarios } = JSON.parse(fs.readFileSync(new URL('../../test-data/fraud-scenarios.json', import.meta.url)));

test.describe('Fraud scoring API: security and input validation', () => {
  test('rejects requests without an API key', async ({ request }) => {
    const res = await request.post('/api/fraud/score', { data: baseContext });
    expect(res.status()).toBe(401);
    expect(await res.json()).toEqual({ error: 'Invalid API key' });
  });

  test('rejects a wrong API key', async ({ bankApi }) => {
    const res = await bankApi.scoreFraud(baseContext, 'not-the-key');
    expect(res.status()).toBe(401);
  });

  const invalidBodies = [
    { name: 'zero amount', patch: { amount: 0 }, field: 'amount' },
    { name: 'negative amount', patch: { amount: -10 }, field: 'amount' },
    { name: 'amount as string', patch: { amount: '100' }, field: 'amount' },
    { name: 'missing amount', patch: { amount: undefined }, field: 'amount' },
    { name: 'negative balance', patch: { balance: -1 }, field: 'balance' },
    { name: 'three-letter country', patch: { country: 'DEU' }, field: 'country' },
    { name: 'numeric country', patch: { country: '49' }, field: 'country' },
  ];
  for (const { name, patch, field } of invalidBodies) {
    test(`returns 400 for ${name}`, async ({ bankApi }) => {
      const res = await bankApi.scoreFraud({ ...baseContext, ...patch });
      expect(res.status()).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('Validation failed');
      expect(Object.keys(body.errors)).toEqual([field]);
    });
  }
});

test.describe('Fraud scoring API: contract', () => {
  test('response matches the published schema', { tag: '@smoke' }, async ({ bankApi }) => {
    const res = await bankApi.scoreFraud(baseContext);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/json');
    const body = await res.json();
    expectFraudScoreContract(body);
    expect(body).toMatchObject({ modelVersion: 'rules-1.0', score: 0, decision: 'APPROVE', reasons: [] });
  });

  test('the score equals the sum of the reasons, capped at 100', async ({ bankApi }) => {
    const res = await bankApi.scoreFraud({
      ...baseContext,
      amount: 25000,
      balance: 26000,
      country: 'IR',
      isNewPayee: true,
      recentTransferCount: 5,
      description: 'urgent bitcoin',
    });
    const body = await res.json();
    const sum = body.reasons.reduce((total, r) => total + r.points, 0);
    expect(sum).toBeGreaterThan(100);
    expect(body.score).toBe(100);
    expect(body.decision).toBe('BLOCK');
  });

  test('country codes are case-insensitive', async ({ bankApi }) => {
    const upper = await (await bankApi.scoreFraud({ ...baseContext, country: 'IR' })).json();
    const lower = await (await bankApi.scoreFraud({ ...baseContext, country: 'ir' })).json();
    expect(lower.score).toBe(upper.score);
  });
});

test.describe('Fraud scoring API: each rule in isolation', () => {
  // One row per rule: the smallest change to the baseline that should make exactly that rule fire.
  const rules = [
    { code: 'LARGE_AMOUNT', points: 25, patch: { amount: 3000 } },
    { code: 'VERY_LARGE_AMOUNT', points: 50, patch: { amount: 10000, balance: 50000 } },
    { code: 'HIGH_RISK_COUNTRY', points: 40, patch: { country: 'KP' } },
    { code: 'NEW_PAYEE', points: 15, patch: { isNewPayee: true } },
    { code: 'HIGH_VELOCITY', points: 30, patch: { recentTransferCount: 3 } },
    { code: 'DRAINS_BALANCE', points: 20, patch: { amount: 90, balance: 100 } },
    { code: 'SUSPICIOUS_DESCRIPTION', points: 20, patch: { description: 'Buy Gift Card now' } },
  ];
  for (const { code, points, patch } of rules) {
    test(`${code} adds ${points} points`, async ({ bankApi }) => {
      const body = await (await bankApi.scoreFraud({ ...baseContext, ...patch })).json();
      expect(body.reasons.map((r) => r.code)).toEqual([code]);
      expect(body.score).toBe(points);
    });
  }
});

test.describe('Fraud scoring API: boundary values', () => {
  const boundaries = [
    { name: 'amount just below the large-amount threshold', patch: { amount: 2999.99 }, score: 0 },
    { name: 'amount at the large-amount threshold', patch: { amount: 3000 }, score: 25 },
    { name: 'amount just below the very-large threshold', patch: { amount: 9999.99, balance: 50000 }, score: 25 },
    { name: '2 recent transfers (below velocity limit)', patch: { recentTransferCount: 2 }, score: 0 },
    { name: 'amount at 89.99% of balance', patch: { amount: 89.99, balance: 100 }, score: 0 },
    { name: 'amount at exactly 90% of balance', patch: { amount: 90, balance: 100 }, score: 20 },
    { name: 'zero balance does not trigger the drain rule', patch: { amount: 50, balance: 0 }, score: 0 },
  ];
  for (const { name, patch, score } of boundaries) {
    test(name, async ({ bankApi }) => {
      const body = await (await bankApi.scoreFraud({ ...baseContext, ...patch })).json();
      expect(body.score).toBe(score);
    });
  }

  const decisionBoundaries = [
    { name: 'score 35 is approved', patch: { isNewPayee: true, description: 'crypto' }, score: 35, decision: 'APPROVE' },
    { name: 'score 40 needs review', patch: { isNewPayee: true, amount: 3000 }, score: 40, decision: 'REVIEW' },
    { name: 'score 65 needs review', patch: { isNewPayee: true, recentTransferCount: 3, description: 'urgent' }, score: 65, decision: 'REVIEW' },
    { name: 'score 70 is blocked', patch: { country: 'IR', recentTransferCount: 3 }, score: 70, decision: 'BLOCK' },
  ];
  for (const { name, patch, score, decision } of decisionBoundaries) {
    test(name, async ({ bankApi }) => {
      const body = await (await bankApi.scoreFraud({ ...baseContext, ...patch })).json();
      expect(body).toMatchObject({ score, decision });
    });
  }
});

test.describe('Fraud scoring API: labeled scenario regression', () => {
  for (const scenario of scenarios) {
    test(`${scenario.id} ${scenario.title} -> ${scenario.expectedDecision}`, { tag: '@fraud' }, async ({ bankApi }) => {
      const body = await (await bankApi.scoreFraud(scenario.context)).json();
      expect(body.decision).toBe(scenario.expectedDecision);
    });
  }
});
