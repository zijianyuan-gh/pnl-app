import { defineConfig, devices } from '@playwright/test';

/** Verifies the REAL published site. LIVE_URL=https://…/pnl-app/ EXPECT_SHA=<commit> npm run e2e:live */
const LIVE_URL = process.env.LIVE_URL ?? 'https://zijianyuan-gh.github.io/pnl-app/';

export default defineConfig({
  testDir: 'tests/live',
  timeout: 90_000,
  retries: 1, // the public internet is involved
  reporter: [['list']],
  use: { baseURL: LIVE_URL, locale: 'en-US', trace: 'off' },
  projects: [
    { name: 'live-iphone-chromium', use: { ...devices['iPhone 14'], browserName: 'chromium' } },
    { name: 'live-iphone-webkit', use: { ...devices['iPhone 14'] } },
    { name: 'live-desktop-chromium', use: { ...devices['Desktop Chrome'], acceptDownloads: true } },
  ],
});
