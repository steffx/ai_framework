import { api, initPage, money, formatDate, esc } from './common.js';

const me = await initPage();

document.getElementById('greeting').textContent = `Good to see you, ${me.name.split(' ')[0]}`;

document.getElementById('accounts').innerHTML = me.accounts
  .map(
    (a) => `
    <article class="card" data-testid="account-card" data-account-type="${esc(a.type)}">
      <h3 class="muted" data-testid="account-type">${esc(a.type)}</h3>
      <p class="balance" data-testid="balance">${money(a.balance)}</p>
      <p class="muted" data-testid="account-iban">${esc(a.maskedIban)}</p>
    </article>`,
  )
  .join('');

document.getElementById('card-number').textContent = me.card.masked;
document.getElementById('card-status').innerHTML = me.card.frozen
  ? '<span class="badge frozen" data-testid="card-frozen-badge">Frozen</span> Payments and card use are paused.'
  : '<span class="badge COMPLETED">Active</span>';

if (me.openAlerts > 0) {
  const banner = document.getElementById('alert-banner');
  banner.innerHTML = `We blocked ${me.openAlerts} suspicious payment${me.openAlerts > 1 ? 's' : ''}. <a href="/card">Review security alerts</a>`;
  banner.hidden = false;
}

const { data: txs } = await api('/api/transactions');
const recent = document.getElementById('recent');
recent.innerHTML = txs.length
  ? txs
      .slice(0, 5)
      .map(
        (t) => `
    <li data-testid="recent-tx">
      <span><strong>${esc(t.counterparty)}</strong><br><span class="muted">${formatDate(t.date)} · ${esc(t.description || '')}</span></span>
      <span class="${t.type === 'CREDIT' ? 'credit' : ''}">${t.type === 'CREDIT' ? '+' : '−'}${money(t.amount)}
        ${t.status !== 'COMPLETED' ? `<span class="badge ${t.status}">${t.status}</span>` : ''}</span>
    </li>`,
      )
      .join('')
  : '<li>No transactions yet.</li>';
