const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    channel: 'chrome',
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true
  },
  webServer: {
    command: 'node tests/support/static-server.js',
    url: 'http://127.0.0.1:4173/',
    reuseExistingServer: true,
    timeout: 30000
  }
});
