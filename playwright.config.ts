import { defineConfig, devices } from '@playwright/test';

const PORT = 4174;
/** Same sub-path the site is published under (GitHub Pages: /pnl-app/). */
export const BASE = process.env.BASE_PATH ?? '/';

/**
 * E2E tests run against the production build (vite preview), so the service worker and
 * manifest are the real ones. WebKit is used automatically when it is installed
 * (PW_WEBKIT=1); this environment only ships Chromium.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 45_000,
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}${BASE}`,
    locale: 'en-US',
    trace: 'off',
  },
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}${BASE}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'iphone-chromium',
      use: { ...devices['iPhone 14'], browserName: 'chromium', deviceScaleFactor: 1 },
    },
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 } },
    },
    ...(process.env.PW_WEBKIT
      ? [{ name: 'iphone-webkit', use: { ...devices['iPhone 14'] } }]
      : []),
  ],
});
