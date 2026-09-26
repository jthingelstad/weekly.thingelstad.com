const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 120000,
  expect: {
    timeout: 15000,
  },
  fullyParallel: false,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'line',
  use: {
    baseURL: 'http://127.0.0.1:8080',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  // Serve the already-built _site (Eleventy + Pagefind) statically, the way it
  // deploys — not the Eleventy dev server. Build first: `npm run build:all`
  // (or `npm test`, which builds then runs these).
  webServer: {
    command:
      'test -f _site/index.html -a -d _site/pagefind || { echo "_site/ is not built: run npm run build:all first" >&2; exit 1; }; exec python3 -m http.server 8080 --bind 127.0.0.1 --directory _site',
    url: 'http://127.0.0.1:8080',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
