import { expect } from '@playwright/test';
import { BasePage } from './BasePage.js';

export class CardPage extends BasePage {
  path = '/card';

  constructor(page) {
    super(page);
    this.paymentCard = page.getByTestId('payment-card');
    this.cardNumber = page.getByTestId('card-number');
    this.freezeToggle = page.getByRole('switch', { name: /Freeze card/ });
    this.freezeStatus = page.getByTestId('freeze-status');
    this.alerts = page.getByTestId('alert-item');
    this.noAlerts = page.getByTestId('no-alerts');
    this.reportDialog = page.getByTestId('report-dialog');
    this.confirmReport = page.getByTestId('confirm-report');
    this.cancelReport = this.reportDialog.getByRole('button', { name: 'Cancel' });
  }

  async waitUntilReady() {
    await expect(this.freezeStatus).not.toBeEmpty();
    await expect(this.alerts.or(this.noAlerts).first()).toBeVisible();
  }

  alertStatus(alert) {
    return alert.getByTestId('alert-status');
  }

  dismissButton(alert) {
    return alert.getByRole('button', { name: 'This was me' });
  }

  reportButton(alert) {
    return alert.getByRole('button', { name: 'Report fraud' });
  }
}
