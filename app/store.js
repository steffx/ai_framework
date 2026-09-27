/**
 * In-memory data store for the demo bank. Everything resets when the server restarts.
 * Test isolation: every test creates its own customer through the test API,
 * so tests can run in parallel without sharing balances or transactions.
 */
import crypto from 'node:crypto';
import { buildIban, maskIban } from './iban.js';

export const MAX_LOGIN_ATTEMPTS = 3;

const users = new Map(); // username -> user
const sessions = new Map(); // session token -> username
const pendingTransfers = new Map(); // transfer id -> { username, draft, code, attempts }

let sequence = 1000;

const hash = (password) => crypto.createHash('sha256').update(password).digest('hex');
export const newId = (prefix) => `${prefix}_${crypto.randomBytes(6).toString('hex')}`;

const daysAgoIso = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

export const LANDLORD = Object.freeze({
  name: 'Harbor Lettings Ltd',
  iban: buildIban('DE', '370400440532013000'),
});

export function createUser({ username, password, name = 'Alex Morgan', checking = 2500, savings = 10000 }) {
  if (users.has(username)) throw new Error(`User ${username} already exists`);
  sequence += 1;
  const accountNo = String(sequence).padStart(10, '0');
  const user = {
    username,
    name,
    passwordHash: hash(password),
    failedLogins: 0,
    locked: false,
    accounts: [
      { id: newId('acc'), type: 'Checking', iban: buildIban('DE', `50010517${accountNo}`), balance: checking },
      { id: newId('acc'), type: 'Savings', iban: buildIban('DE', `50010518${accountNo}`), balance: savings },
    ],
    card: { last4: String(4000 + (sequence % 5000)).slice(-4), frozen: false },
    payees: new Set([LANDLORD.iban]),
    transactions: [],
    alerts: [],
  };
  const checkingId = user.accounts[0].id;
  user.transactions.push(
    seedTx(checkingId, 'CREDIT', 'ACME Corporation', buildIban('GB', 'WEST12345698765432'), 3200, 'Salary', 12),
    seedTx(checkingId, 'DEBIT', LANDLORD.name, LANDLORD.iban, 950, 'Rent', 10),
    seedTx(checkingId, 'DEBIT', 'FreshMart Groceries', buildIban('FR', '20041010050500013M02606'), 64.2, 'Groceries', 3),
  );
  users.set(username, user);
  return user;
}

function seedTx(accountId, type, counterparty, iban, amount, description, daysAgo) {
  return {
    id: newId('tx'),
    accountId,
    date: daysAgoIso(daysAgo),
    type,
    counterparty,
    iban,
    amount,
    currency: 'EUR',
    description,
    status: 'COMPLETED',
    riskScore: 0,
    reasons: [],
  };
}

export const getUser = (username) => users.get(username);

export function verifyPassword(user, password) {
  return user.passwordHash === hash(password);
}

export function createSession(username) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, username);
  return token;
}

export const destroySession = (token) => sessions.delete(token);
export const userForSession = (token) => (token && sessions.has(token) ? users.get(sessions.get(token)) : undefined);

export function publicProfile(user) {
  return {
    username: user.username,
    name: user.name,
    // Data minimisation: the full IBAN never leaves the server, only the masked form.
    accounts: user.accounts.map(({ iban, ...account }) => ({ ...account, maskedIban: maskIban(iban) })),
    card: { masked: `**** **** **** ${user.card.last4}`, frozen: user.card.frozen },
    openAlerts: user.alerts.filter((a) => a.status === 'OPEN').length,
  };
}

export function publicTransaction(tx) {
  return { ...tx, iban: maskIban(tx.iban) };
}

export const savePending = (id, value) => pendingTransfers.set(id, value);
export const getPending = (id) => pendingTransfers.get(id);
export const deletePending = (id) => pendingTransfers.delete(id);

// A demo customer for exploring the app by hand.
createUser({ username: 'demo', password: 'Demo123!', name: 'Demo Customer' });
