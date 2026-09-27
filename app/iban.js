/**
 * IBAN helpers (ISO 13616). Validation checks the format and the mod-97 checksum.
 * Shared by the app and the test data builders.
 */

function mod97(numeric) {
  let remainder = 0;
  for (const digit of numeric) {
    remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder;
}

function toNumeric(str) {
  return str
    .split('')
    .map((ch) => (/[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch))
    .join('');
}

export function normalizeIban(value) {
  return String(value || '').replace(/\s+/g, '').toUpperCase();
}

export function isValidIban(value) {
  const iban = normalizeIban(value);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  return mod97(toNumeric(rearranged)) === 1;
}

/** Builds a valid IBAN for a country code and a basic bank account number (BBAN). */
export function buildIban(countryCode, bban) {
  const cc = countryCode.toUpperCase();
  const cleanBban = normalizeIban(bban);
  const check = 98 - mod97(toNumeric(cleanBban + cc + '00'));
  return cc + String(check).padStart(2, '0') + cleanBban;
}

export function ibanCountry(value) {
  return normalizeIban(value).slice(0, 2);
}

export function maskIban(value) {
  const iban = normalizeIban(value);
  return `${iban.slice(0, 4)} **** **** ${iban.slice(-4)}`;
}
