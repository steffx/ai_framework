import { expect } from '@playwright/test';
import { BasePage } from './BasePage.js';
import { parseEur } from '../utils/money.js';

export class TransactionsPage extends BasePage {
  path = '/transactions';

  constructor(page) {
    super(page);
    this.statusFilter = page.getByLabel('Status');
    this.search = page.getByRole('searchbox', { name: 'Search' });
    this.exportButton = page.getByTestId('export-csv');
    this.sortByAmount = page.getByTestId('sort-amount');
    this.amountHeader = page.locator('#amount-header');
    this.rows = page.getByTestId('tx-row');
    this.resultCount = page.getByTestId('result-count');
    this.emptyState = page.getByTestId('empty-state');
    this.detailsDialog = page.getByTestId('tx-details');
    this.detailsRiskScore = page.getByTestId('details-risk-score');
    this.detailsReasons = page.getByTestId('details-reasons');
    this.detailsStatus = page.getByTestId('details-status');
    this.detailsIban = page.getByTestId('details-iban');
    this.closeDetails = this.detailsDialog.getByRole('button', { name: 'Close' });
  }

  async waitUntilReady() {
    await expect(this.resultCount).toHaveText(/Showing \d+ transactions?/);
  }

  row(counterparty) {
    return this.rows.filter({ has: this.page.getByTestId('tx-counterparty').getByText(counterparty, { exact: true }) });
  }

  async filterByStatus(label) {
    await this.statusFilter.selectOption({ label });
  }

  async searchFor(text) {
    await this.search.fill(text);
  }

  async amounts() {
    const texts = await this.rows.getByTestId('tx-amount').allInnerTexts();
    return texts.map((t) => Math.abs(parseEur(t)));
  }

  /** Clicks Export and returns the downloaded CSV as { filename, lines }. */
  async exportCsv() {
    const downloadPromise = this.page.waitForEvent('download');
    await this.exportButton.click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return {
      filename: download.suggestedFilename(),
      lines: Buffer.concat(chunks).toString('utf8').trim().split('\n'),
    };
  }
}
