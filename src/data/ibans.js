import crypto from 'node:crypto';
import { buildIban } from '../../app/iban.js';

/** The payee every new test customer has already paid (seeded rent payment). */
export const KNOWN_PAYEE = Object.freeze({
  name: 'Harbor Lettings Ltd',
  iban: 'DE89370400440532013000',
});

const randomDigits = (length) =>
  Array.from({ length }, () => crypto.randomInt(0, 10)).join('');

/** A syntactically valid IBAN (correct mod-97 checksum) for any country, never seen before by the customer. */
export function newIban(country = 'NL') {
  return buildIban(country, randomDigits(18));
}

/** Changes the last digit so the checksum no longer matches. */
export function withBrokenChecksum(iban) {
  const last = Number(iban.at(-1));
  return iban.slice(0, -1) + String((last + 1) % 10);
}

export const groupIban = (iban) => iban.replace(/(.{4})/g, '$1 ').trim();
