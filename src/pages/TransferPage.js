import { expect } from '@playwright/test';
import { BasePage } from './BasePage.js';

export class TransferPage extends BasePage {
  path = '/transfer';

  constructor(page) {
    super(page);
    // Step 1: details
    this.detailsStep = page.getByTestId('step-details');
    this.fromAccount = page.getByLabel('Pay from');
    this.recipientName = page.getByLabel('Recipient name');
    this.recipientIban = page.getByLabel('Recipient IBAN');
    this.amount = page.getByLabel('Amount (EUR)');
    this.reference = page.getByLabel(/Payment reference/);
    this.referenceCounter = page.getByTestId('description-counter');
    this.continueButton = page.getByRole('button', { name: 'Continue' });
    this.formError = page.getByTestId('transfer-error');
    // Step 2: review
    this.reviewStep = page.getByTestId('step-review');
    this.reviewName = page.getByTestId('review-name');
    this.reviewIban = page.getByTestId('review-iban');
    this.reviewAmount = page.getByTestId('review-amount');
    this.reviewReference = page.getByTestId('review-reference');
    this.reviewFrom = page.getByTestId('review-from');
    this.confirmButton = page.getByTestId('confirm-transfer');
    this.editButton = page.getByTestId('edit-transfer');
    // Step-up verification
    this.otpPanel = page.getByTestId('otp-panel');
    this.otpInput = page.getByLabel('Security code');
    this.verifyButton = page.getByTestId('verify-otp');
    this.otpError = page.getByTestId('otp-error');
    // Results
    this.success = page.getByTestId('transfer-success');
    this.newBalance = page.getByTestId('new-balance');
    this.blocked = page.getByTestId('transfer-blocked');
    this.riskReasons = page.getByTestId('risk-reason');
    this.cancelled = page.getByTestId('transfer-cancelled');
    this.progressStep = page.locator('.steps li[aria-current="step"]');
  }

  async waitUntilReady() {
    await expect(this.fromAccount.locator('option').first()).toBeAttached();
  }

  fieldError(field) {
    return this.page.getByTestId(`error-${field}`);
  }

  async fillDetails({ from, recipientName, recipientIban, amount, reference }) {
    if (from) {
      // Option labels include the live balance ("Savings · €10,000.00"), so match on the account type.
      const option = this.fromAccount.locator('option').filter({ hasText: new RegExp(`^${from} `) });
      await this.fromAccount.selectOption(await option.getAttribute('value'));
    }
    if (recipientName !== undefined) await this.recipientName.fill(recipientName);
    if (recipientIban !== undefined) await this.recipientIban.fill(recipientIban);
    if (amount !== undefined) await this.amount.fill(String(amount));
    if (reference !== undefined) await this.reference.fill(reference);
  }

  async submitDetails(details) {
    await this.fillDetails(details);
    await this.continueButton.click();
  }

  /** Fills the form, continues to review and confirms. */
  async send(details) {
    await this.submitDetails(details);
    await expect(this.reviewStep).toBeVisible();
    await this.confirmButton.click();
  }

  async enterOtp(code) {
    await this.otpInput.fill(code);
    await this.verifyButton.click();
  }

  /** Reads the pending transfer id from the confirm response, so tests can fetch the one-time code. */
  async sendAndCaptureTransferId(details) {
    await this.submitDetails(details);
    await expect(this.reviewStep).toBeVisible();
    const responsePromise = this.page.waitForResponse(
      (r) => r.url().endsWith('/api/transfers') && r.request().method() === 'POST',
    );
    await this.confirmButton.click();
    const body = await (await responsePromise).json();
    return body.transactionId;
  }
}
