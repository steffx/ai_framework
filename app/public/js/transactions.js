import { api, initPage, money, formatDate, esc } from './common.js';

await initPage();

const statusFilter = document.getElementById('status-filter');
const search = document.getElementById('search');
const rows = document.getElementById('rows');
const dialog = document.getElementById('details-dialog');
let transactions = [];
let sortDirection = null; // null | 'ascending' | 'descending'

const signed = (t) => (t.type === 'CREDIT' ? t.amount : -t.amount);

function render() {
  const list = [...transactions];
  if (sortDirection) list.sort((a, b) => (sortDirection === 'ascending' ? 1 : -1) * (a.amount - b.amount));
  document.getElementById('amount-header').setAttribute('aria-sort', sortDirection || 'none');

  rows.innerHTML = list
    .map(
      (t) => `
    <tr data-testid="tx-row" data-id="${t.id}" tabindex="0">
      <td>${formatDate(t.date)}</td>
      <td data-testid="tx-counterparty">${esc(t.counterparty)}</td>
      <td>${esc(t.description || '')}</td>
      <td><span class="badge ${t.status}" data-testid="tx-status">${t.status}</span></td>
      <td class="amount ${t.type === 'CREDIT' ? 'credit' : ''}" data-testid="tx-amount">${t.type === 'CREDIT' ? '+' : '−'}${money(t.amount)}</td>
    </tr>`,
    )
    .join('');
  document.getElementById('empty-state').hidden = list.length > 0;
  document.getElementById('result-count').textContent = `Showing ${list.length} transaction${list.length === 1 ? '' : 's'}`;
}

async function load() {
  const params = new URLSearchParams({ status: statusFilter.value });
  if (search.value.trim()) params.set('q', search.value.trim());
  const { data } = await api(`/api/transactions?${params}`);
  transactions = data;
  render();
}

let debounce;
search.addEventListener('input', () => {
  clearTimeout(debounce);
  debounce = setTimeout(load, 300);
});
statusFilter.addEventListener('change', load);

document.getElementById('sort-amount').addEventListener('click', () => {
  sortDirection = sortDirection === 'descending' ? 'ascending' : 'descending';
  render();
});

function openDetails(id) {
  const t = transactions.find((tx) => tx.id === id);
  document.getElementById('details-body').innerHTML = `
    <dt>Counterparty</dt><dd>${esc(t.counterparty)}</dd>
    <dt>IBAN</dt><dd data-testid="details-iban">${esc(t.iban)}</dd>
    <dt>Amount</dt><dd>${money(signed(t))}</dd>
    <dt>Status</dt><dd data-testid="details-status">${t.status}</dd>
    <dt>Risk score</dt><dd data-testid="details-risk-score">${t.riskScore}/100</dd>
    <dt>Risk signals</dt><dd data-testid="details-reasons">${t.reasons.length ? t.reasons.join(', ') : 'None'}</dd>`;
  dialog.showModal();
}

rows.addEventListener('click', (e) => {
  const row = e.target.closest('tr[data-id]');
  if (row) openDetails(row.dataset.id);
});
rows.addEventListener('keydown', (e) => {
  const row = e.target.closest('tr[data-id]');
  if (row && e.key === 'Enter') openDetails(row.dataset.id);
});
document.getElementById('close-details').addEventListener('click', () => dialog.close());

document.getElementById('export-button').addEventListener('click', () => {
  const header = 'date,counterparty,iban,reference,status,amount,currency';
  const quote = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = transactions.map((t) =>
    [t.date, t.counterparty, t.iban, t.description, t.status, signed(t).toFixed(2), t.currency].map(quote).join(','),
  );
  const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `novapay-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
});

await load();
