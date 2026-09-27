import { api, initPage, money, esc } from './common.js';
import { isValidIban, normalizeIban } from './iban.js';

const me = await initPage();

const form = document.getElementById('transfer-form');
const formError = document.getElementById('form-error');
const sections = {
  details: document.getElementById('step-details'),
  review: document.getElementById('step-review'),
  otp: document.getElementById('step-otp'),
  result: document.getElementById('step-result'),
};
let draft = null;
let pendingId = null;

form.fromAccountId.innerHTML = me.accounts
  .map((a) => `<option value="${a.id}">${esc(a.type)} · ${money(a.balance)}</option>`)
  .join('');

function showStep(name) {
  Object.entries(sections).forEach(([key, el]) => (el.hidden = key !== name));
  const progress = name === 'otp' ? 'result' : name;
  document.querySelectorAll('.steps li').forEach((li) => {
    if (li.dataset.step === progress) li.setAttribute('aria-current', 'step');
    else li.removeAttribute('aria-current');
  });
}

function showErrors(errors = {}) {
  form.querySelectorAll('[data-error-for]').forEach((el) => {
    const field = el.dataset.errorFor;
    el.textContent = errors[field] || '';
    form.elements[field]?.setAttribute('aria-invalid', errors[field] ? 'true' : 'false');
  });
  const first = Object.keys(errors)[0];
  if (first) form.elements[first]?.focus();
}

function clientValidate(values) {
  const errors = {};
  if (!values.recipientName) errors.recipientName = 'Recipient name is required';
  if (!values.recipientIban) errors.recipientIban = 'IBAN is required';
  else if (!isValidIban(values.recipientIban)) errors.recipientIban = 'Enter a valid IBAN';
  if (!values.amount) errors.amount = 'Amount is required';
  else if (!/^\d+(\.\d{1,2})?$/.test(values.amount)) errors.amount = 'Enter an amount with up to 2 decimals';
  else if (Number(values.amount) <= 0) errors.amount = 'Amount must be greater than zero';
  return errors;
}

// Group the IBAN in blocks of 4 when the field loses focus, like real banking apps do.
form.recipientIban.addEventListener('blur', () => {
  const iban = normalizeIban(form.recipientIban.value);
  form.recipientIban.value = iban.replace(/(.{4})/g, '$1 ').trim();
});

form.description.addEventListener('input', () => {
  document.getElementById('description-counter').textContent = `${form.description.value.length}/140`;
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  formError.hidden = true;
  const values = {
    fromAccountId: form.fromAccountId.value,
    recipientName: form.recipientName.value.trim(),
    recipientIban: normalizeIban(form.recipientIban.value),
    amount: form.amount.value.trim().replace(',', '.'),
    description: form.description.value.trim(),
  };
  const errors = clientValidate(values);
  showErrors(errors);
  if (Object.keys(errors).length) return;

  draft = values;
  const account = me.accounts.find((a) => a.id === values.fromAccountId);
  document.getElementById('review-summary').innerHTML = `
    <dt>From</dt><dd data-testid="review-from">${esc(account.type)}</dd>
    <dt>To</dt><dd data-testid="review-name">${esc(values.recipientName)}</dd>
    <dt>IBAN</dt><dd data-testid="review-iban">${esc(values.recipientIban.replace(/(.{4})/g, '$1 ').trim())}</dd>
    <dt>Amount</dt><dd data-testid="review-amount">${money(Number(values.amount))}</dd>
    <dt>Reference</dt><dd data-testid="review-reference">${esc(values.description || '—')}</dd>`;
  showStep('review');
});

document.getElementById('edit-button').addEventListener('click', () => showStep('details'));

function showResult(kind, payload = {}) {
  showStep('result');
  ['success', 'blocked', 'cancelled'].forEach((k) => (document.getElementById(`result-${k}`).hidden = k !== kind));
  if (kind === 'success') {
    document.getElementById('success-message').textContent =
      `${money(Number(draft.amount))} is on its way to ${draft.recipientName}.`;
    document.getElementById('new-balance').textContent = money(payload.balance);
  }
  if (kind === 'blocked') {
    document.getElementById('blocked-reasons').innerHTML = payload.reasons
      .map((r) => `<li data-testid="risk-reason" data-code="${r.code}">${esc(r.description)}</li>`)
      .join('');
  }
  if (kind === 'cancelled') {
    document.getElementById('cancelled-message').textContent = payload.message;
  }
}

const confirmButton = document.getElementById('confirm-button');
confirmButton.addEventListener('click', async () => {
  confirmButton.disabled = true;
  confirmButton.textContent = 'Sending…';
  const { ok, status, data } = await api('/api/transfers', { method: 'POST', body: draft });
  confirmButton.disabled = false;
  confirmButton.textContent = 'Confirm and send';

  if (!ok) {
    showStep('details');
    showErrors(data.errors || {});
    if (!data.errors || status === 403) {
      formError.textContent = data.error;
      formError.hidden = false;
    }
    return;
  }
  if (data.status === 'COMPLETED') showResult('success', data);
  else if (data.status === 'BLOCKED') showResult('blocked', data);
  else if (data.status === 'OTP_REQUIRED') {
    pendingId = data.transactionId;
    showStep('otp');
    document.getElementById('otp').focus();
  }
});

document.getElementById('otp-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const code = document.getElementById('otp').value.trim();
  const otpError = document.getElementById('otp-error');
  if (!/^\d{6}$/.test(code)) {
    otpError.textContent = 'Enter the 6-digit code';
    return;
  }
  const { ok, data } = await api(`/api/transfers/${pendingId}/otp`, { method: 'POST', body: { code } });
  if (ok) return showResult('success', data);
  if (data.status === 'CANCELLED') return showResult('cancelled', { message: data.error });
  otpError.textContent = data.attemptsLeft
    ? `Incorrect code. ${data.attemptsLeft} attempt${data.attemptsLeft === 1 ? '' : 's'} left.`
    : data.error;
  document.getElementById('otp').value = '';
});
