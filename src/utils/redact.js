/**
 * Removes customer data before anything is sent to an external AI service
 * or written to a report. Financial test logs must not leak account numbers,
 * card numbers, passwords or session tokens, even in test environments.
 */
const RULES = [
  [/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g, '[IBAN]'],
  [/\b\d(?:[ -]?\d){12,18}\b/g, '[CARD]'],
  [/("?password"?\s*[:=]\s*)"[^"]*"/gi, '$1"[REDACTED]"'],
  [/Passw0rd!|Demo123!/g, '[REDACTED]'],
  [/\bsid=[a-f0-9]{16,}\b/gi, 'sid=[TOKEN]'],
  [/\b[a-f0-9]{48}\b/gi, '[TOKEN]'],
  [/\b(sk-[A-Za-z0-9_-]{10,}|sk-ant-[A-Za-z0-9_-]{10,})\b/g, '[API_KEY]'],
];

export function redact(text) {
  return RULES.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), String(text ?? ''));
}
