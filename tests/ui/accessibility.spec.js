import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '../../src/fixtures/test.js';

/**
 * Automated WCAG 2.1 AA checks with axe-core. Banks in the EU must meet the
 * European Accessibility Act, so serious or critical violations fail the build.
 */
async function scan(page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const blocking = results.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
  const summary = blocking.map((v) => `${v.id} (${v.impact}): ${v.help} -> ${v.nodes.map((n) => n.target).join(', ')}`);
  return { results, summary };
}

test.describe('Accessibility', { tag: '@a11y' }, () => {
  test('login page', async ({ page, loginPage }, testInfo) => {
    await loginPage.goto();
    const { results, summary } = await scan(page);
    await testInfo.attach('axe-results', { body: JSON.stringify(results.violations, null, 2), contentType: 'application/json' });
    expect(summary).toEqual([]);
  });

  test('login page with validation errors', async ({ page, loginPage }) => {
    await loginPage.goto();
    await loginPage.submitButton.click();
    await expect(loginPage.usernameError).not.toBeEmpty();
    const { summary } = await scan(page);
    expect(summary).toEqual([]);
  });

  for (const path of ['/dashboard', '/transfer', '/transactions', '/card']) {
    test(`signed-in page ${path}`, async ({ page, signedIn }, testInfo) => {
      await page.goto(path);
      await expect(page.locator('#app-header nav')).toBeAttached();
      await page.waitForLoadState('networkidle');
      const { results, summary } = await scan(page);
      await testInfo.attach('axe-results', { body: JSON.stringify(results.violations, null, 2), contentType: 'application/json' });
      expect(summary).toEqual([]);
    });
  }
});
