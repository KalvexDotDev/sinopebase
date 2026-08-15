import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.pw.ts',
  timeout: 15000,
  retries: 1,
  use: {
    baseURL: 'http://127.0.0.1:9876',
    headless: true,
    launchOptions: {
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  },

  // Bun server starts before tests, tears down after. Uses Bun runtime
  // (not Node) because the server imports Bun APIs (Bun.password, etc.).
  // Playwright test runner itself runs on Node.js — only the server uses Bun.
  webServer: {
    command: `bun run cmd/serve.ts --port 9876 --host 127.0.0.1 --postgresUrl ${process.env.TEST_POSTGRES_URL || 'postgresql://sinopebase:sinopebase@localhost:5432/sinopebase'} --jwtSecret e2e-jwt-secret-min-32-chars!!!`,
    url: 'http://127.0.0.1:9876/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 15000,
    env: {
      SINOPEBASE_SERVICE_ROLE_KEY: 'e2e-key-service-min-32-chars!!',
      SINOPEBASE_ANON_KEY: 'e2e-key-anon-min-32-chars!!!!!',
      // No RUSTFS_* env vars: storage falls back to the local file store
      // (pb_data/) so e2e runs do not need a local S3/RustFS instance.
    },
  },
})
