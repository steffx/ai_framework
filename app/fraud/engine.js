/**
 * Rule-based fraud scoring engine.
 *
 * Each rule inspects the transaction context and, when it fires, adds points
 * to the risk score. The final score (capped at 100) maps to a decision:
 *
 *   score >= 70  -> BLOCK    (payment rejected, security alert raised)
 *   score >= 40  -> REVIEW   (customer must confirm with a one-time code)
 *   otherwise    -> APPROVE
 */

export const THRESHOLDS = Object.freeze({ block: 70, review: 40 });

export const HIGH_RISK_COUNTRIES = Object.freeze(['IR', 'KP', 'MM', 'SY', 'YE', 'AF']);

const SUSPICIOUS_KEYWORDS = /gift\s?card|crypto|bitcoin|urgent|lottery|investment opportunity|wire immediately/i;

export const RULES = Object.freeze([
  {
    code: 'VERY_LARGE_AMOUNT',
    points: 50,
    description: 'Amount is 10,000 or more',
    applies: (ctx) => ctx.amount >= 10000,
  },
  {
    code: 'LARGE_AMOUNT',
    points: 25,
    description: 'Amount is between 3,000 and 10,000',
    applies: (ctx) => ctx.amount >= 3000 && ctx.amount < 10000,
  },
  {
    code: 'HIGH_RISK_COUNTRY',
    points: 40,
    description: 'Recipient bank is in a high-risk jurisdiction',
    applies: (ctx) => HIGH_RISK_COUNTRIES.includes(String(ctx.country || '').toUpperCase()),
  },
  {
    code: 'NEW_PAYEE',
    points: 15,
    description: 'First payment to this recipient',
    applies: (ctx) => Boolean(ctx.isNewPayee),
  },
  {
    code: 'HIGH_VELOCITY',
    points: 30,
    description: '3 or more transfers in the last 10 minutes',
    applies: (ctx) => (ctx.recentTransferCount || 0) >= 3,
  },
  {
    code: 'DRAINS_BALANCE',
    points: 20,
    description: 'Transfer uses 90% or more of the available balance',
    applies: (ctx) => ctx.balance > 0 && ctx.amount >= ctx.balance * 0.9,
  },
  {
    code: 'SUSPICIOUS_DESCRIPTION',
    points: 20,
    description: 'Payment reference contains scam-related keywords',
    applies: (ctx) => SUSPICIOUS_KEYWORDS.test(ctx.description || ''),
  },
]);

/**
 * @param {object} ctx
 * @param {number} ctx.amount
 * @param {number} ctx.balance
 * @param {string} ctx.country            ISO 3166 alpha-2 code of the recipient bank
 * @param {boolean} ctx.isNewPayee
 * @param {number} ctx.recentTransferCount transfers in the last 10 minutes
 * @param {string} [ctx.description]
 * @returns {{score:number, decision:'APPROVE'|'REVIEW'|'BLOCK', reasons:{code:string,points:number,description:string}[]}}
 */
export function scoreTransaction(ctx) {
  const reasons = RULES.filter((rule) => rule.applies(ctx)).map(({ code, points, description }) => ({
    code,
    points,
    description,
  }));
  const score = Math.min(100, reasons.reduce((sum, r) => sum + r.points, 0));
  let decision = 'APPROVE';
  if (score >= THRESHOLDS.block) decision = 'BLOCK';
  else if (score >= THRESHOLDS.review) decision = 'REVIEW';
  return { score, decision, reasons };
}
