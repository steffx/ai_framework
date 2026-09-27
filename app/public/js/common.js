// Shared helpers for every signed-in page.

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/login') {
    window.location.href = '/login?expired=1';
    throw new Error('Session expired');
  }
  return { ok: res.ok, status: res.status, data };
}

export const money = (value) =>
  new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(value);

export const formatDate = (iso) =>
  new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

const NAV = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/transfer', label: 'Send money' },
  { href: '/transactions', label: 'Transactions' },
  { href: '/card', label: 'Card & security' },
];

function renderHeader(me) {
  const header = document.getElementById('app-header');
  const current = window.location.pathname.replace(/\.html$/, '');
  header.innerHTML = `
    <a class="brand" href="/dashboard">Nova<span>Pay</span></a>
    <button class="menu-toggle secondary" data-testid="menu-toggle" aria-expanded="false" aria-controls="main-nav">Menu</button>
    <nav class="nav" id="main-nav" aria-label="Main">
      ${NAV.map((n) => `<a href="${n.href}" ${n.href === current ? 'aria-current="page"' : ''}>${n.label}</a>`).join('')}
    </nav>
    <div class="user-box">
      <span data-testid="user-name">${esc(me.name)}</span>
      <button class="secondary" data-testid="logout-button">Log out</button>
    </div>`;
  header.querySelector('[data-testid="logout-button"]').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' });
    window.location.href = '/login?loggedOut=1';
  });
  const toggle = header.querySelector('.menu-toggle');
  toggle.addEventListener('click', () => {
    const open = header.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  });
}

/** Loads the signed-in customer (redirects to login if the session is gone) and draws the header. */
export async function initPage() {
  const { data: me } = await api('/api/me');
  renderHeader(me);
  return me;
}

export function showToast(message) {
  document.querySelector('.toast')?.remove();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');
  toast.dataset.testid = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}
