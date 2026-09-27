import { expect } from '@playwright/test';
import { BasePage } from './BasePage.js';

export class LoginPage extends BasePage {
  path = '/login';

  constructor(page) {
    super(page);
    this.username = page.getByLabel('Username');
    this.password = page.getByLabel('Password', { exact: true });
    this.showPassword = page.getByLabel('Show password');
    this.submitButton = page.getByRole('button', { name: 'Sign in' });
    this.error = page.getByTestId('login-error');
    this.notice = page.getByTestId('login-notice');
    this.usernameError = page.getByTestId('username-error');
    this.passwordError = page.getByTestId('password-error');
  }

  async waitUntilReady() {
    await expect(this.submitButton).toBeEnabled();
  }

  async login(username, password) {
    await this.username.fill(username);
    await this.password.fill(password);
    await this.submitButton.click();
  }
}
