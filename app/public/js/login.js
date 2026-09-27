const form = document.getElementById('login-form');
const errorBox = document.getElementById('error');
const notice = document.getElementById('notice');
const button = document.getElementById('login-button');

const params = new URLSearchParams(window.location.search);
if (params.has('expired')) {
  notice.textContent = 'Your session has expired. Please sign in again.';
  notice.hidden = false;
} else if (params.has('loggedOut')) {
  notice.textContent = 'You have been logged out securely.';
  notice.hidden = false;
}

document.getElementById('show-password').addEventListener('change', (e) => {
  document.getElementById('password').type = e.target.checked ? 'text' : 'password';
});

function setFieldError(id, message) {
  const input = document.getElementById(id);
  document.getElementById(`${id}-error`).textContent = message;
  input.setAttribute('aria-invalid', message ? 'true' : 'false');
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorBox.hidden = true;
  const username = form.username.value.trim();
  const password = form.password.value;
  setFieldError('username', username ? '' : 'Enter your username');
  setFieldError('password', password ? '' : 'Enter your password');
  if (!username || !password) return;

  button.disabled = true;
  button.textContent = 'Signing in…';
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (res.ok) {
      window.location.href = '/dashboard';
      return;
    }
    let message = data.error;
    if (res.status === 401 && typeof data.attemptsLeft === 'number') {
      message += `. ${data.attemptsLeft} attempt${data.attemptsLeft === 1 ? '' : 's'} left before your account is locked.`;
    }
    errorBox.textContent = message;
    errorBox.hidden = false;
    form.password.value = '';
  } catch {
    errorBox.textContent = 'We could not reach the server. Check your connection and try again.';
    errorBox.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = 'Sign in';
  }
});
