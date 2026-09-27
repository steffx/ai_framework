import { test, expect } from '../../src/fixtures/test.js';
import { KNOWN_PAYEE, newIban } from '../../src/data/ibans.js';

test.describe('Transaction history', () => {
  test('lists all transactions with a count', { tag: ['@smoke', '@mobile'] }, async ({ signedIn, transactionsPage }) => {
    await transactionsPage.goto();

    await expect(transactionsPage.rows).toHaveCount(3);
    await expect(transactionsPage.resultCount).toHaveText('Showing 3 transactions');
    await expect(transactionsPage.row('ACME Corporation').getByTestId('tx-amount')).toHaveText('+€3,200.00');
    await expect(transactionsPage.row('Harbor Lettings Ltd').getByTestId('tx-amount')).toHaveText('−€950.00');
  });

  test.describe('with a blocked payment', () => {
    test.beforeEach(async ({ customerApi }) => {
      const res = await customerApi.transfer({
        recipientName: 'Crypto Gains Ltd',
        recipientIban: newIban('IR'),
        amount: 1500,
        description: 'crypto investment opportunity',
      });
      expect((await res.json()).status).toBe('BLOCKED');
    });

    test('filters by status', async ({ transactionsPage }) => {
      await transactionsPage.goto();
      await expect(transactionsPage.rows).toHaveCount(4);

      await transactionsPage.filterByStatus('Blocked');
      await expect(transactionsPage.rows).toHaveCount(1);
      await expect(transactionsPage.rows.getByTestId('tx-status')).toHaveText('BLOCKED');

      await transactionsPage.filterByStatus('Completed');
      await expect(transactionsPage.rows).toHaveCount(3);
      await expect(transactionsPage.rows.getByTestId('tx-status')).toHaveText(Array(3).fill('COMPLETED'));
    });

    test('details dialog explains why the payment was blocked', async ({ transactionsPage }) => {
      await transactionsPage.goto();
      await transactionsPage.row('Crypto Gains Ltd').click();

      await expect(transactionsPage.detailsDialog).toBeVisible();
      await expect(transactionsPage.detailsStatus).toHaveText('BLOCKED');
      await expect(transactionsPage.detailsRiskScore).toHaveText('75/100');
      await expect(transactionsPage.detailsReasons).toHaveText('HIGH_RISK_COUNTRY, NEW_PAYEE, SUSPICIOUS_DESCRIPTION');
      await expect(transactionsPage.detailsIban).toHaveText(/^IR\d{2} \*{4} \*{4} \d{4}$/);

      await transactionsPage.closeDetails.click();
      await expect(transactionsPage.detailsDialog).toBeHidden();
    });

    test('details dialog opens with the keyboard and closes with Escape', async ({ page, transactionsPage }) => {
      await transactionsPage.goto();
      await transactionsPage.row('Crypto Gains Ltd').focus();
      await page.keyboard.press('Enter');
      await expect(transactionsPage.detailsDialog).toBeVisible();

      await page.keyboard.press('Escape');
      await expect(transactionsPage.detailsDialog).toBeHidden();
    });
  });

  test('searches by counterparty and reference', async ({ signedIn, transactionsPage }) => {
    await transactionsPage.goto();

    await transactionsPage.searchFor('harbor');
    await expect(transactionsPage.rows).toHaveCount(1);
    await expect(transactionsPage.rows.getByTestId('tx-counterparty')).toHaveText('Harbor Lettings Ltd');

    await transactionsPage.searchFor('Salary');
    await expect(transactionsPage.rows.getByTestId('tx-counterparty')).toHaveText('ACME Corporation');
  });

  test('shows an empty state when nothing matches', async ({ signedIn, transactionsPage }) => {
    await transactionsPage.goto();
    await transactionsPage.searchFor('no such merchant');

    await expect(transactionsPage.emptyState).toBeVisible();
    await expect(transactionsPage.resultCount).toHaveText('Showing 0 transactions');
  });

  test('sorts by amount, descending then ascending', async ({ signedIn, transactionsPage }) => {
    await transactionsPage.goto();

    await transactionsPage.sortByAmount.click();
    await expect(transactionsPage.amountHeader).toHaveAttribute('aria-sort', 'descending');
    expect(await transactionsPage.amounts()).toEqual([3200, 950, 64.2]);

    await transactionsPage.sortByAmount.click();
    await expect(transactionsPage.amountHeader).toHaveAttribute('aria-sort', 'ascending');
    expect(await transactionsPage.amounts()).toEqual([64.2, 950, 3200]);
  });

  test('a new payment appears at the top of the list', async ({ customerApi, transactionsPage }) => {
    await customerApi.transfer({ recipientName: KNOWN_PAYEE.name, recipientIban: KNOWN_PAYEE.iban, amount: 42, description: 'Late fee' });

    await transactionsPage.goto();
    await expect(transactionsPage.rows.first()).toContainText('Late fee');
    await expect(transactionsPage.rows.first().getByTestId('tx-amount')).toHaveText('−€42.00');
  });

  test('exports the visible transactions as CSV without full account numbers', async ({ signedIn, transactionsPage }) => {
    await transactionsPage.goto();
    const { filename, lines } = await transactionsPage.exportCsv();

    expect(filename).toMatch(/^novapay-transactions-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(lines[0]).toBe('date,counterparty,iban,reference,status,amount,currency');
    expect(lines).toHaveLength(4);
    expect(lines.find((l) => l.includes('ACME Corporation'))).toContain('"3200.00","EUR"');
    expect(lines.find((l) => l.includes('Harbor Lettings Ltd'))).toContain('"-950.00","EUR"');
    // GDPR / PCI: exported files contain masked IBANs only.
    for (const line of lines.slice(1)) {
      expect(line).toMatch(/"[A-Z]{2}\d{2} \*{4} \*{4} [A-Z0-9]{4}"/);
    }
  });

  test('export respects the active filter', async ({ signedIn, transactionsPage }) => {
    await transactionsPage.goto();
    await transactionsPage.searchFor('FreshMart');
    await expect(transactionsPage.rows).toHaveCount(1);

    const { lines } = await transactionsPage.exportCsv();
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('FreshMart Groceries');
  });
});
