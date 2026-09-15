import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: 'http://localhost:8081',
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'python3 -m http.server 8081 --directory apps/mobile/dist',
    url: 'http://localhost:8081',
    reuseExistingServer: !process.env.CI,
  },
});
