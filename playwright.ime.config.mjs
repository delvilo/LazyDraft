import { defineConfig } from '@playwright/test';

const chromeExecutable = process.env.IME_CHROME_PATH || undefined;
const edgeExecutable = process.env.IME_EDGE_PATH || undefined;

export default defineConfig({
  testDir: './tests/ime-browser',
  timeout: 30000,
  expect: {
    timeout: 5000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:8802',
    serviceWorkers: 'block',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'python3 -m http.server 8802 --bind 127.0.0.1',
    port: 8802,
    reuseExistingServer: false,
    timeout: 10000,
  },
  projects: [
    {
      name: 'chrome',
      use: {
        browserName: 'chromium',
        ...(chromeExecutable
          ? { launchOptions: { executablePath: chromeExecutable } }
          : { channel: 'chrome' }),
      },
    },
    {
      name: 'msedge',
      use: {
        browserName: 'chromium',
        ...(edgeExecutable
          ? { launchOptions: { executablePath: edgeExecutable } }
          : { channel: 'msedge' }),
      },
    },
  ],
});
