import { api, initPage, formatDate, esc, showToast } from './common.js';

const me = await initPage();

const toggle = document.getElementById('freeze-toggle');
const dialog = document.getElementById('report-dialog');
let alertToReport = null;

document.getElementById('card-number').textContent = me.card.masked;
document.getElementById('card-holder').textContent = me.name.toUpperCase();

function renderFrozen(frozen) {
  toggle.setAttribute('aria-checked', String(frozen));
  document.getElementById('payment-card').classList.toggle('is-frozen', frozen);
  document.getElementById('freeze-status').textContent = frozen
    ? 'Your card is frozen. Card payments and outgoing transfers are blocked.'
    : 'Your card is active.';
}
renderFrozen(me.card.frozen);

toggle.addEventListener('click', async () => {
  const frozen = toggle.getAttribute('aria-checked') !== 'true';
  const { data } = await api('/api/card/freeze', { method: 'POST', body: { frozen } });
  renderFrozen(data.frozen);
  showToast(data.frozen ? 'Card frozen' : 'Card unfrozen');
});

const STATUS_TEXT = { OPEN: 'Needs your review', CONFIRMED_FRAUD: 'Reported as fraud', DISMISSED: 'Marked as genuine' };

async function loadAlerts() {
  const { data: alerts } = await api('/api/alerts');
  const list = document.getElementById('alerts');
  list.innerHTML = alerts.length
    ? alerts
        .map(
          (a) => `
      <li data-testid="alert-item" data-id="${a.id}">
        <span>${esc(a.message)}<br>
          <span class="muted">${formatDate(a.date)} · <span data-testid="alert-status">${STATUS_TEXT[a.status]}</span></span>
        </span>
        ${
          a.status === 'OPEN'
            ? `<span class="actions">
                 <button class="secondary" data-action="dismiss">This was me</button>
                 <button class="danger" data-action="report">Report fraud</button>
               </span>`
            : ''
        }
      </li>`,
        )
        .join('')
    : '<li data-testid="no-alerts">No security alerts. We will let you know if we spot anything unusual.</li>';
}

document.getElementById('alerts').addEventListener('click', async (e) => {
  const button = e.target.closest('button[data-action]');
  if (!button) return;
  const id = button.closest('li').dataset.id;
  if (button.dataset.action === 'report') {
    alertToReport = id;
    dialog.showModal();
    return;
  }
  await api(`/api/alerts/${id}`, { method: 'POST', body: { action: 'dismiss' } });
  showToast('Thanks, we marked this payment as genuine');
  loadAlerts();
});

document.getElementById('cancel-report').addEventListener('click', () => dialog.close());
document.getElementById('confirm-report').addEventListener('click', async () => {
  const { data } = await api(`/api/alerts/${alertToReport}`, { method: 'POST', body: { action: 'report' } });
  dialog.close();
  renderFrozen(data.cardFrozen);
  showToast('Fraud reported. Your card is now frozen.');
  loadAlerts();
});

await loadAlerts();
