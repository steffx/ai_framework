import { expect } from '@playwright/test';
import { BasePage } from './BasePage.js';
import { parseEur } from '../utils/money.js';

export class DashboardPage extends BasePage {
  path = '/dashboard';

  constructor(page) {
    super(page);
    this.greeting = page.getByTestId('greeting');
    this.accountCards = page.getByTestId('account-card');
    this.fraudAlertBanner = page.getByTestId('fraud-alert-banner');
    this.cardSummary = page.getByTestId('card-summary');
    this.cardNumber = page.getByTestId('card-number');
    this.cardFrozenBadge = page.getByTestId('card-frozen-badge');
    this.recentTransactions = page.getByTestId('recent-tx');
    this.sendMoneyButton = page.getByTestId('send-money');
  }

  async waitUntilReady() {
    await expect(this.greeting).not.toHaveText('Loading…');
    await expect(this.accountCards.first()).toBeVisible();
  }

  account(type) {
    return this.page.locator(`[data-testid="account-card"][data-account-type="${type}"]`);
  }

  async balanceOf(type) {
    return parseEur(await this.account(type).getByTestId('balance').innerText());
  }
}
