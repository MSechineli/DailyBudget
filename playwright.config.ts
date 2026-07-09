import { defineConfig, devices } from '@playwright/test';

// Testes E2E: dirigem o app de verdade num Chromium headless (IndexedDB real,
// sem mockar Alpine/store). Cada teste roda numa context nova do Playwright,
// então o IndexedDB começa vazio a cada teste — não precisa limpar manualmente.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 420, height: 900 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
