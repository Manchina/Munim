import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  expect: { timeout: 10000 },
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command: 'npm exec -- tsx tests/e2e/server.ts',
      url: 'http://127.0.0.1:3000/health/ready',
      reuseExistingServer: false,
    },
    {
      command: 'npm run preview --workspace @munim/web -- --port 5173 --strictPort',
      url: 'http://localhost:5173',
      reuseExistingServer: false,
    },
  ],
  reporter: [['list'], ['html', { open: 'never' }]],
});
