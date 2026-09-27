import { test, expect } from '@playwright/test';
import { isValidIban, buildIban, maskIban } from '../../app/iban.js';
import { scoreTransaction, THRESHOLDS } from '../../app/fraud/engine.js';
import { computeMetrics } from '../../src/eval/metrics.js';
import { redact } from '../../src/utils/redact.js';
import { parseEur } from '../../src/utils/money.js';
import { validateScenario } from '../../ai/generate-scenarios.js';

test.describe('IBAN helpers', () => {
  for (const iban of ['DE89370400440532013000', 'GB82WEST12345698765432', 'NL91ABNA0417164300', 'MD24AG000225100013104168']) {
    test(`accepts the official example ${iban}`, () => {
      expect(isValidIban(iban)).toBe(true);
    });
  }

  test('accepts lower case and spaces', () => {
    expect(isValidIban('de89 3704 0044 0532 0130 00')).toBe(true);
  });

  test('rejects a wrong checksum', () => {
    expect(isValidIban('DE89370400440532013001')).toBe(false);
  });

  test('buildIban produces valid IBANs', () => {
    expect(buildIban('DE', '370400440532013000')).toBe('DE89370400440532013000');
    expect(isValidIban(buildIban('IR', '0620000000100324200001'))).toBe(true);
  });

  test('masks all but the country, check digits and last 4 characters', () => {
    expect(maskIban('DE89370400440532013000')).toBe('DE89 **** **** 3000');
  });
});

test.describe('Fraud engine', () => {
  test('clean payment scores zero', () => {
    expect(scoreTransaction({ amount: 10, balance: 1000, country: 'DE', isNewPayee: false, recentTransferCount: 0 })).toEqual({
      score: 0,
      decision: 'APPROVE',
      reasons: [],
    });
  });

  test('block threshold is above the review threshold', () => {
    expect(THRESHOLDS.block).toBeGreaterThan(THRESHOLDS.review);
  });
});

test.describe('Evaluation metrics', () => {
  test('computes precision, recall and false block rate', () => {
    const m = computeMetrics([
      { id: 'a', label: 'fraud', decision: 'BLOCK' },
      { id: 'b', label: 'fraud', decision: 'REVIEW' },
      { id: 'c', label: 'fraud', decision: 'APPROVE' },
      { id: 'd', label: 'legit', decision: 'APPROVE' },
      { id: 'e', label: 'legit', decision: 'REVIEW' },
      { id: 'f', label: 'legit', decision: 'BLOCK' },
    ]);
    expect(m.confusionMatrix).toEqual({ truePositive: 2, falsePositive: 2, falseNegative: 1, trueNegative: 1 });
    expect(m.precision).toBe(0.5);
    expect(m.recall).toBe(0.667);
    expect(m.falseBlockRate).toBe(0.333);
    expect(m.missedFraud).toEqual(['c']);
    expect(m.falseAlarms).toEqual(['e', 'f']);
  });

  test('handles an empty dataset without dividing by zero', () => {
    expect(computeMetrics([])).toMatchObject({ precision: 0, recall: 0, f1: 0 });
  });
});

test.describe('Redaction of customer data', () => {
  const cases = [
    ['compact IBAN', 'paid to DE89370400440532013000 ok', 'paid to [IBAN] ok'],
    ['grouped IBAN', 'IBAN DE89 3704 0044 0532 0130 00', 'IBAN [IBAN]'],
    ['card number', 'card 4111 1111 1111 1111 declined', 'card [CARD] declined'],
    ['password in JSON', '{"password":"hunter2"}', '{"password":"[REDACTED]"}'],
    ['session cookie', 'Cookie: sid=0123456789abcdef0123456789abcdef', 'Cookie: sid=[TOKEN]'],
    ['API key', 'key sk-ant-abc123def456ghi789', 'key [API_KEY]'],
  ];
  for (const [name, input, expected] of cases) {
    test(`redacts ${name}`, () => {
      expect(redact(input)).toBe(expected);
    });
  }

  test('keeps masked IBANs and ordinary text', () => {
    const text = 'Expected "DE89 **** **** 3000" to be visible after 5000ms';
    expect(redact(text)).toBe(text);
  });
});

test.describe('Money parsing', () => {
  for (const [text, value] of [['€2,500.00', 2500], ['−€950.00', -950], ['+€3,200.00', 3200], ['-€0.10', -0.1]]) {
    test(`parses ${text}`, () => expect(parseEur(text)).toBe(value));
  }
});

test.describe('Generated scenario validation', () => {
  const valid = {
    title: 'Rent',
    label: 'legit',
    context: { amount: 900, balance: 2000, country: 'DE', isNewPayee: false, recentTransferCount: 0, description: 'Rent' },
  };

  test('accepts a valid scenario', () => {
    expect(validateScenario(valid)).toEqual([]);
  });

  test('reports every problem in an invalid scenario', () => {
    const problems = validateScenario({
      title: 'Bad',
      label: 'maybe',
      context: { amount: -1, balance: 0, country: 'Germany', isNewPayee: 'yes', recentTransferCount: 1.5, description: 5 },
    });
    expect(problems).toHaveLength(6);
  });

  test('rejects a balance that does not cover the amount', () => {
    expect(validateScenario({ ...valid, context: { ...valid.context, balance: 100 } })).toEqual(['balance must cover the amount']);
  });
});
