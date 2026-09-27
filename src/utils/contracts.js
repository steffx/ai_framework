/** Minimal JSON contract checks for API responses (kept dependency-free on purpose). */
import { expect } from '@playwright/test';

export const DECISIONS = ['APPROVE', 'REVIEW', 'BLOCK'];

export function expectFraudScoreContract(body) {
  expect(body).toEqual({
    modelVersion: expect.any(String),
    score: expect.any(Number),
    decision: expect.any(String),
    reasons: expect.any(Array),
  });
  expect(Number.isInteger(body.score)).toBe(true);
  expect(body.score).toBeGreaterThanOrEqual(0);
  expect(body.score).toBeLessThanOrEqual(100);
  expect(DECISIONS).toContain(body.decision);
  for (const reason of body.reasons) {
    expect(reason).toEqual({
      code: expect.stringMatching(/^[A-Z_]+$/),
      points: expect.any(Number),
      description: expect.any(String),
    });
  }
}

/** A legitimate baseline payment: every test changes only the fields it cares about. */
export const baseContext = Object.freeze({
  amount: 100,
  balance: 5000,
  country: 'DE',
  isNewPayee: false,
  recentTransferCount: 0,
  description: 'Groceries',
});
