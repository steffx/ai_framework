import { test, expect } from '../../src/fixtures/test.js';

test.describe('Authentication', () => {
  test('customer signs in and lands on the dashboard', { tag: ['@smoke', '@mobile'] }, async ({
    page,
    customer,
    loginPage,
    dashboardPage,
  }) => {
    await loginPage.goto();
    await loginPage.login(customer.username, customer.password);

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(dashboardPage.greeting).toHaveText('Good to see you, Alex');
  });

  test('empty form shows field-level validation and does not call the API', async ({ page, loginPage }) => {
    let loginCalls = 0;
    page.on('request', (r) => r.url().endsWith('/api/login') && loginCalls++);

    await loginPage.goto();
    await loginPage.submitButton.click();

    await expect(loginPage.usernameError).toHaveText('Enter your username');
    await expect(loginPage.passwordError).toHaveText('Enter your password');
    await expect(loginPage.username).toHaveAttribute('aria-invalid', 'true');
    expect(loginCalls).toBe(0);
  });

  test('wrong password warns how many attempts are left and clears the password', async ({ customer, loginPage }) => {
    await loginPage.goto();
    await loginPage.login(customer.username, 'wrong-password');

    await expect(loginPage.error).toHaveText(
      'Invalid username or password. 2 attempts left before your account is locked.',
    );
    await expect(loginPage.password).toHaveValue('');
  });

  test('account is locked after 3 failed attempts, even with the right password afterwards', async ({
    page,
    customer,
    loginPage,
  }) => {
    await loginPage.goto();
    for (const expected of ['2 attempts left', '1 attempt left']) {
      await loginPage.login(customer.username, 'wrong-password');
      await expect(loginPage.error).toContainText(expected);
    }
    await loginPage.login(customer.username, 'wrong-password');
    await expect(loginPage.error).toHaveText('Account locked after too many failed attempts. Contact support.');

    await loginPage.login(customer.username, customer.password);
    await expect(loginPage.error).toContainText('Account locked');
    await expect(page).toHaveURL(/\/login/);
  });

  test('unknown username gets the same generic error (no user enumeration)', async ({ loginPage }) => {
    await loginPage.goto();
    await loginPage.login('no_such_user', 'whatever');

    await expect(loginPage.error).toHaveText('Invalid username or password');
    await expect(loginPage.error).not.toContainText('attempt');
  });

  test('show password toggles the input type', async ({ loginPage }) => {
    await loginPage.goto();
    await loginPage.password.fill('Secret123');

    await expect(loginPage.password).toHaveAttribute('type', 'password');
    await loginPage.showPassword.check();
    await expect(loginPage.password).toHaveAttribute('type', 'text');
    await loginPage.showPassword.uncheck();
    await expect(loginPage.password).toHaveAttribute('type', 'password');
  });

  test('logging out ends the session', { tag: '@mobile' }, async ({ page, signedIn, dashboardPage, loginPage }) => {
    await dashboardPage.goto();
    await dashboardPage.header.logout();

    await expect(loginPage.notice).toHaveText('You have been logged out securely.');

    // The old session must not work any more.
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login\?expired=1/);
    await expect(loginPage.notice).toContainText('Your session has expired');
  });

  for (const path of ['/dashboard', '/transfer', '/transactions', '/card']) {
    test(`${path} redirects anonymous visitors to the login page`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login\?expired=1/);
    });
  }

  test('session cookie is HttpOnly and SameSite=Strict', async ({ page, customer, loginPage }) => {
    await loginPage.goto();
    await loginPage.login(customer.username, customer.password);
    await expect(page).toHaveURL(/\/dashboard$/);

    const sid = (await page.context().cookies()).find((c) => c.name === 'sid');
    expect(sid, 'session cookie').toBeDefined();
    expect(sid.httpOnly).toBe(true);
    expect(sid.sameSite).toBe('Strict');
    // JavaScript on the page must not be able to read it.
    expect(await page.evaluate(() => document.cookie)).not.toContain('sid=');
  });
});
