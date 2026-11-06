import { defineConfig, devices } from '@playwright/test';

/** Tests the packaged Mac launcher binary (DAYBOOK_BIN). Run: npm run e2e:mac */
export default defineConfig({
  testDir: 'tests/mac',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:47823/', locale: 'en-US', trace: 'off' },
  projects: [
    { name: 'mac-chromium', use: { ...devices['Desktop Chrome'] } },
    ...(process.env.PW_WEBKIT ? [{ name: 'mac-webkit', use: { ...devices['Desktop Safari'] } }] : []),
  ],
});
