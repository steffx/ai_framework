#!/usr/bin/env node
/**
 * Generates new labeled fraud / legitimate payment scenarios for the model evaluation.
 *
 *   npm run ai:generate                  # 20 scenarios
 *   npm run ai:generate -- --count 40
 *
 * With ANTHROPIC_API_KEY or OPENAI_API_KEY set, an LLM invents realistic scenarios based on
 * known fraud typologies. Without a key, a template-based generator is used instead.
 * Every scenario is schema-validated before it is saved; invalid ones are dropped and reported.
 *
 * Output: test-data/generated-scenarios.json (git-ignored). Review it, then promote good cases
 * into test-data/fraud-scenarios.json. AI-generated labels are never trusted blindly.
 */
import fs from 'node:fs';
import { complete, extractJson, llmAvailable, llmProvider } from './llm.js';

const OUTPUT = new URL('../test-data/generated-scenarios.json', import.meta.url);
const count = Number(process.argv[process.argv.indexOf('--count') + 1]) || 20;

// ---------- validation ----------
export function validateScenario(s) {
  const problems = [];
  const c = s?.context || {};
  if (!['fraud', 'legit'].includes(s?.label)) problems.push('label must be "fraud" or "legit"');
  if (!s?.title || typeof s.title !== 'string') problems.push('title missing');
  if (typeof c.amount !== 'number' || c.amount <= 0 || c.amount > 50000) problems.push('amount must be 0 < amount <= 50000');
  if (typeof c.balance !== 'number' || c.balance < c.amount) problems.push('balance must cover the amount');
  if (!/^[A-Z]{2}$/.test(c.country || '')) problems.push('country must be ISO alpha-2 uppercase');
  if (typeof c.isNewPayee !== 'boolean') problems.push('isNewPayee must be boolean');
  if (!Number.isInteger(c.recentTransferCount) || c.recentTransferCount < 0) problems.push('recentTransferCount must be a non-negative integer');
  if (typeof c.description !== 'string' || c.description.length > 140) problems.push('description must be a string up to 140 chars');
  return problems;
}

// ---------- LLM generator ----------
const SYSTEM = `You are a fraud analyst at a European retail bank creating test data for a payment fraud engine.
Return ONLY JSON. No explanations.`;

function buildPrompt(n) {
  return `Create ${n} realistic single-payment scenarios, roughly half fraud and half legitimate.
Cover diverse typologies: authorised push payment scams (safe-account, impersonation, romance, investment,
purchase scams), invoice redirection, account takeover, money mules, and ordinary legitimate payments
(rent, bills, gifts, large but genuine purchases, payments abroad). Include tricky cases that a simple
rule engine might get wrong (small fraud, large legitimate payments).

Return a JSON array. Each item:
{
  "title": "short description",
  "label": "fraud" | "legit",
  "recipientName": "name",
  "context": {
    "amount": number (EUR, > 0, <= 50000),
    "balance": number (>= amount, account balance before paying),
    "country": "ISO 3166 alpha-2 of the recipient bank, uppercase",
    "isNewPayee": boolean,
    "recentTransferCount": integer (outgoing transfers in the last 10 minutes),
    "description": "payment reference the customer typed, max 140 chars"
  }
}`;
}

async function generateWithLlm(n) {
  const text = await complete({ system: SYSTEM, prompt: buildPrompt(n), maxTokens: 6000 });
  const items = extractJson(text);
  if (!Array.isArray(items)) throw new Error('Model did not return an array');
  return items;
}

// ---------- offline fallback ----------
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const between = (min, max) => Math.round((min + Math.random() * (max - min)) * 100) / 100;

const TEMPLATES = [
  { label: 'fraud', title: 'Safe-account scam', make: () => { const bal = between(3000, 20000); return { amount: Math.round(bal * between(0.85, 1)), balance: bal, country: pick(['LT', 'GB', 'DE']), isNewPayee: true, recentTransferCount: 0, description: pick(['Safe account', 'Security transfer', 'urgent']) }; } },
  { label: 'fraud', title: 'Investment scam', make: () => ({ amount: between(500, 15000), balance: 20000, country: pick(['EE', 'CY', 'IR']), isNewPayee: true, recentTransferCount: 0, description: pick(['crypto', 'bitcoin trading', 'investment opportunity']) }) },
  { label: 'fraud', title: 'Account takeover burst', make: () => ({ amount: between(200, 2000), balance: 2500, country: pick(['NL', 'RO', 'GB']), isNewPayee: true, recentTransferCount: pick([3, 4, 6]), description: '' }) },
  { label: 'fraud', title: 'Gift card scam', make: () => ({ amount: between(100, 900), balance: 3000, country: 'DE', isNewPayee: true, recentTransferCount: pick([0, 2, 3]), description: pick(['gift cards', 'Gift card payment']) }) },
  { label: 'fraud', title: 'Payment to high-risk jurisdiction', make: () => ({ amount: between(50, 5000), balance: 10000, country: pick(['KP', 'IR', 'SY', 'MM']), isNewPayee: true, recentTransferCount: 0, description: 'Invoice' }) },
  { label: 'fraud', title: 'Low-value advance-fee scam', make: () => ({ amount: between(50, 450), balance: 2000, country: pick(['DE', 'FR']), isNewPayee: true, recentTransferCount: 0, description: pick(['processing fee', 'customs fee', 'lottery release']) }) },
  { label: 'legit', title: 'Rent to known landlord', make: () => ({ amount: between(600, 1600), balance: 3000, country: 'DE', isNewPayee: false, recentTransferCount: 0, description: 'Rent' }) },
  { label: 'legit', title: 'Gift to family abroad', make: () => ({ amount: between(20, 400), balance: 2500, country: pick(['IT', 'ES', 'PL', 'MD']), isNewPayee: pick([true, false]), recentTransferCount: 0, description: pick(['Birthday', 'Happy holidays', 'For you']) }) },
  { label: 'legit', title: 'Large genuine purchase', make: () => ({ amount: between(3000, 12000), balance: 40000, country: pick(['DE', 'AT', 'FR']), isNewPayee: true, recentTransferCount: 0, description: pick(['Car', 'Kitchen renovation', 'Wedding venue']) }) },
  { label: 'legit', title: 'Everyday bill payment', make: () => ({ amount: between(15, 250), balance: 1800, country: 'DE', isNewPayee: false, recentTransferCount: pick([0, 1, 3]), description: pick(['Electricity', 'Phone bill', 'Gym']) }) },
];

function generateOffline(n) {
  return Array.from({ length: n }, (_, i) => {
    const t = TEMPLATES[i % TEMPLATES.length];
    return { title: t.title, label: t.label, recipientName: 'Generated Payee', context: t.make() };
  });
}

// ---------- main ----------
async function main() {
  const provider = llmProvider();
  let raw;
  let source;
  if (llmAvailable()) {
    console.log(`Generating ${count} scenarios with ${provider.name}:${provider.model}…`);
    raw = await generateWithLlm(count);
    source = `${provider.name}:${provider.model}`;
  } else {
    console.log('No ANTHROPIC_API_KEY / OPENAI_API_KEY set: using the offline template generator.');
    raw = generateOffline(count);
    source = 'offline-templates';
  }

  const scenarios = [];
  const rejected = [];
  raw.forEach((s, i) => {
    const problems = validateScenario(s);
    if (problems.length) rejected.push({ index: i, title: s?.title, problems });
    else scenarios.push({ id: `G${String(i + 1).padStart(2, '0')}`, ...s });
  });

  fs.writeFileSync(
    OUTPUT,
    JSON.stringify({ generatedBy: source, generatedAt: new Date().toISOString(), scenarios }, null, 2) + '\n',
  );

  const fraud = scenarios.filter((s) => s.label === 'fraud').length;
  console.log(`Saved ${scenarios.length} scenarios (${fraud} fraud, ${scenarios.length - fraud} legit) to test-data/generated-scenarios.json`);
  if (rejected.length) {
    console.log(`Rejected ${rejected.length} invalid scenario(s):`);
    for (const r of rejected) console.log(`  #${r.index} ${r.title ?? '(no title)'}: ${r.problems.join('; ')}`);
  }
  console.log('Next: npx playwright test tests/api/fraud-model-eval.spec.js');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
