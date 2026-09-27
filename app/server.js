import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { scoreTransaction } from './fraud/engine.js';
import { isValidIban, normalizeIban, ibanCountry } from './iban.js';
import {
  MAX_LOGIN_ATTEMPTS,
  createUser,
  getUser,
  verifyPassword,
  createSession,
  destroySession,
  userForSession,
  publicProfile,
  publicTransaction,
  savePending,
  getPending,
  deletePending,
  newId,
} from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const FRAUD_API_KEY = process.env.FRAUD_API_KEY || 'local-dev-key';
const TEST_API_ENABLED = process.env.ENABLE_TEST_API !== 'false';
const SINGLE_TRANSFER_LIMIT = 50000;
const VELOCITY_WINDOW_MS = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 3;

const app = express();
app.use(express.json());

// ---------- helpers ----------
function readCookie(req, name) {
  const header = req.headers.cookie || '';
  const match = header.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : undefined;
}

function requireAuth(req, res, next) {
  const user = userForSession(readCookie(req, 'sid'));
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  req.user = user;
  req.sessionToken = readCookie(req, 'sid');
  next();
}

const round2 = (n) => Math.round(n * 100) / 100;
const eur = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' });

function recentTransferCount(user) {
  const since = Date.now() - VELOCITY_WINDOW_MS;
  return user.transactions.filter((t) => t.type === 'DEBIT' && t.initiatedInSession && Date.parse(t.date) >= since)
    .length;
}

function validateTransfer(user, body) {
  const errors = {};
  const account = user.accounts.find((a) => a.id === body.fromAccountId);
  if (!account) errors.fromAccountId = 'Select an account to pay from';

  const name = String(body.recipientName || '').trim();
  if (!name) errors.recipientName = 'Recipient name is required';
  else if (name.length < 2 || name.length > 70) errors.recipientName = 'Recipient name must be 2-70 characters';
  else if (!/^[\p{L} .,'&-]+$/u.test(name)) errors.recipientName = 'Recipient name contains invalid characters';

  const iban = normalizeIban(body.recipientIban);
  if (!iban) errors.recipientIban = 'IBAN is required';
  else if (!isValidIban(iban)) errors.recipientIban = 'Enter a valid IBAN';
  else if (user.accounts.some((a) => a.iban === iban)) errors.recipientIban = 'Use "Move money" to transfer between your own accounts';

  const rawAmount = String(body.amount ?? '').trim();
  const amount = Number(rawAmount);
  if (!rawAmount) errors.amount = 'Amount is required';
  else if (!/^\d+(\.\d{1,2})?$/.test(rawAmount)) errors.amount = 'Enter an amount with up to 2 decimals';
  else if (amount <= 0) errors.amount = 'Amount must be greater than zero';
  else if (amount > SINGLE_TRANSFER_LIMIT) errors.amount = 'Amount exceeds the single transfer limit of €50,000.00';

  const description = String(body.description || '').trim();
  if (description.length > 140) errors.description = 'Reference must be 140 characters or fewer';

  return { errors, account, name, iban, amount: round2(amount), description };
}

function completeTransfer(user, draft, fraud, status = 'COMPLETED') {
  const account = user.accounts.find((a) => a.id === draft.accountId);
  if (status === 'COMPLETED') {
    account.balance = round2(account.balance - draft.amount);
    user.payees.add(draft.iban);
  }
  const tx = {
    id: draft.id,
    accountId: draft.accountId,
    date: new Date().toISOString(),
    type: 'DEBIT',
    counterparty: draft.name,
    iban: draft.iban,
    amount: draft.amount,
    currency: 'EUR',
    description: draft.description,
    status,
    riskScore: fraud.score,
    decision: fraud.decision,
    reasons: fraud.reasons.map((r) => r.code),
    initiatedInSession: true,
  };
  user.transactions.push(tx);
  return tx;
}

function raiseAlert(user, tx) {
  user.alerts.push({
    id: newId('alert'),
    transactionId: tx.id,
    date: new Date().toISOString(),
    message: `We blocked a payment of ${eur.format(tx.amount)} to ${tx.counterparty}.`,
    status: 'OPEN',
  });
}

// ---------- auth ----------
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
  const user = getUser(String(username).trim());
  if (user?.locked) {
    return res.status(423).json({ error: 'Account locked after too many failed attempts. Contact support.' });
  }
  if (!user || !verifyPassword(user, password)) {
    if (user) {
      user.failedLogins += 1;
      if (user.failedLogins >= MAX_LOGIN_ATTEMPTS) {
        user.locked = true;
        return res.status(423).json({ error: 'Account locked after too many failed attempts. Contact support.' });
      }
    }
    return res.status(401).json({
      error: 'Invalid username or password',
      attemptsLeft: user ? MAX_LOGIN_ATTEMPTS - user.failedLogins : undefined,
    });
  }
  user.failedLogins = 0;
  const token = createSession(user.username);
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Strict; Path=/`);
  res.json({ name: user.name });
});

app.post('/api/logout', (req, res) => {
  destroySession(readCookie(req, 'sid'));
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => res.json(publicProfile(req.user)));

// ---------- transactions ----------
app.get('/api/transactions', requireAuth, (req, res) => {
  const { status, q } = req.query;
  let list = [...req.user.transactions].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  if (status && status !== 'ALL') list = list.filter((t) => t.status === status);
  if (q) {
    const needle = String(q).toLowerCase();
    list = list.filter((t) => `${t.counterparty} ${t.description}`.toLowerCase().includes(needle));
  }
  res.json(list.map(publicTransaction));
});

// ---------- transfers ----------
app.post('/api/transfers', requireAuth, (req, res) => {
  const user = req.user;
  const { errors, account, name, iban, amount, description } = validateTransfer(user, req.body || {});
  if (Object.keys(errors).length) return res.status(400).json({ error: 'Validation failed', errors });

  if (user.card.frozen) {
    return res.status(403).json({
      error: 'Payments are frozen. Unfreeze your card in Card & security to send money.',
    });
  }
  if (amount > account.balance) {
    return res.status(422).json({ error: 'Insufficient funds', errors: { amount: 'Insufficient funds in the selected account' } });
  }

  const fraud = scoreTransaction({
    amount,
    balance: account.balance,
    country: ibanCountry(iban),
    isNewPayee: !user.payees.has(iban),
    recentTransferCount: recentTransferCount(user),
    description,
  });
  const draft = { id: newId('tx'), accountId: account.id, name, iban, amount, description };

  if (fraud.decision === 'BLOCK') {
    const tx = completeTransfer(user, draft, fraud, 'BLOCKED');
    raiseAlert(user, tx);
    return res.json({ status: 'BLOCKED', transactionId: tx.id, riskScore: fraud.score, reasons: fraud.reasons });
  }

  if (fraud.decision === 'REVIEW') {
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    savePending(draft.id, { username: user.username, draft, fraud, code, attempts: 0 });
    return res.json({ status: 'OTP_REQUIRED', transactionId: draft.id, riskScore: fraud.score, reasons: fraud.reasons });
  }

  const tx = completeTransfer(user, draft, fraud);
  res.json({ status: 'COMPLETED', transactionId: tx.id, riskScore: fraud.score, reasons: fraud.reasons, balance: account.balance });
});

app.post('/api/transfers/:id/otp', requireAuth, (req, res) => {
  const pending = getPending(req.params.id);
  if (!pending || pending.username !== req.user.username) return res.status(404).json({ error: 'Transfer not found' });

  if (String(req.body?.code || '') !== pending.code) {
    pending.attempts += 1;
    const attemptsLeft = MAX_OTP_ATTEMPTS - pending.attempts;
    if (attemptsLeft <= 0) {
      deletePending(req.params.id);
      completeTransfer(req.user, pending.draft, pending.fraud, 'CANCELLED');
      return res.status(403).json({ status: 'CANCELLED', error: 'Too many incorrect codes. The payment was cancelled.' });
    }
    return res.status(400).json({ error: 'Incorrect code', attemptsLeft });
  }

  const account = req.user.accounts.find((a) => a.id === pending.draft.accountId);
  deletePending(req.params.id);
  if (pending.draft.amount > account.balance) {
    return res.status(422).json({ error: 'Insufficient funds' });
  }
  const tx = completeTransfer(req.user, pending.draft, pending.fraud);
  res.json({ status: 'COMPLETED', transactionId: tx.id, balance: account.balance });
});

// ---------- card & alerts ----------
app.post('/api/card/freeze', requireAuth, (req, res) => {
  req.user.card.frozen = Boolean(req.body?.frozen);
  res.json({ frozen: req.user.card.frozen });
});

app.get('/api/alerts', requireAuth, (req, res) => {
  res.json([...req.user.alerts].reverse());
});

app.post('/api/alerts/:id', requireAuth, (req, res) => {
  const alert = req.user.alerts.find((a) => a.id === req.params.id);
  if (!alert) return res.status(404).json({ error: 'Alert not found' });
  const action = req.body?.action;
  if (action === 'report') {
    alert.status = 'CONFIRMED_FRAUD';
    req.user.card.frozen = true; // protect the customer immediately
  } else if (action === 'dismiss') {
    alert.status = 'DISMISSED';
  } else {
    return res.status(400).json({ error: 'action must be "report" or "dismiss"' });
  }
  res.json({ alert, cardFrozen: req.user.card.frozen });
});

// ---------- fraud scoring service (machine-to-machine) ----------
app.post('/api/fraud/score', (req, res) => {
  if (req.get('x-api-key') !== FRAUD_API_KEY) return res.status(401).json({ error: 'Invalid API key' });
  const body = req.body || {};
  const errors = {};
  if (typeof body.amount !== 'number' || !Number.isFinite(body.amount) || body.amount <= 0) {
    errors.amount = 'amount must be a positive number';
  }
  if (typeof body.balance !== 'number' || body.balance < 0) errors.balance = 'balance must be a non-negative number';
  if (!/^[A-Za-z]{2}$/.test(String(body.country || ''))) errors.country = 'country must be an ISO 3166 alpha-2 code';
  if (Object.keys(errors).length) return res.status(400).json({ error: 'Validation failed', errors });

  res.json({
    modelVersion: 'rules-1.0',
    ...scoreTransaction({
      amount: body.amount,
      balance: body.balance,
      country: body.country,
      isNewPayee: Boolean(body.isNewPayee),
      recentTransferCount: Number(body.recentTransferCount || 0),
      description: String(body.description || ''),
    }),
  });
});

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// ---------- test-only hooks (disabled with ENABLE_TEST_API=false) ----------
if (TEST_API_ENABLED) {
  app.post('/api/test/users', (req, res) => {
    const username = `user_${crypto.randomBytes(5).toString('hex')}`;
    const password = 'Passw0rd!';
    const { checking, savings, name } = req.body || {};
    createUser({ username, password, name, checking, savings });
    res.status(201).json({ username, password });
  });

  // Simulates reading the one-time code from the customer's SMS inbox.
  app.get('/api/test/otp/:id', (req, res) => {
    const pending = getPending(req.params.id);
    if (!pending) return res.status(404).json({ error: 'No pending transfer' });
    res.json({ code: pending.code });
  });
}

// ---------- pages ----------
app.get('/', (_req, res) => res.redirect('/login'));
// The browser reuses the same IBAN validator as the server.
app.get('/js/iban.js', (_req, res) => res.type('application/javascript').sendFile(path.join(__dirname, 'iban.js')));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.listen(PORT, () => {
  console.log(`NovaPay demo bank running at http://localhost:${PORT}`);
});
