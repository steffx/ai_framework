import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT || 3100);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// Optional: point Playwright at a custom Chromium binary (useful behind strict corporate proxies).
const launchOptions = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ['junit', { outputFile: 'test-results/junit.xml' }],
    ['./ai/failure-analyzer-reporter.js'],
  ],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'en-GB',
    timezoneId: 'Europe/Berlin',
  },
  projects: [
    {
      // Fast checks of pure helpers (IBAN, metrics, redaction): no browser, no server calls.
      name: 'unit',
      testDir: './tests/unit',
    },
    {
      name: 'api',
      testDir: './tests/api',
    },
    {
      name: 'desktop-chromium',
      testDir: './tests/ui',
      use: { ...devices['Desktop Chrome'], launchOptions },
    },
    {
      // Mobile emulation runs only the journeys tagged @mobile.
      name: 'mobile-chromium',
      testDir: './tests/ui',
      grep: /@mobile/,
      use: { ...devices['Pixel 7'], launchOptions },
    },
  ],
  webServer: {
    command: 'node app/server.js',
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !process.env.CI,
    env: { PORT: String(PORT) },
    timeout: 30_000,
  },
});
