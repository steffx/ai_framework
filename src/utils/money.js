/**
 * Converts a displayed amount such as "€2,500.00", "−€950.00" or "+€3,200.00" into a number.
 * Handles both the ASCII hyphen and the Unicode minus sign the UI uses.
 */
export function parseEur(text) {
  const clean = String(text).trim();
  const negative = /^[-−]/.test(clean);
  const value = Number(clean.replace(/[^\d.]/g, ''));
  if (Number.isNaN(value)) throw new Error(`Cannot parse amount from "${text}"`);
  return negative ? -value : value;
}

export const formatEur = (value) =>
  new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(value);
