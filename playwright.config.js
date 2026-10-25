import { defineConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default defineConfig({
  testDir: './ui-tests',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:3100', browserName: 'chromium', viewport: { width: 1280, height: 800 } },
  webServer: {
    command: 'node ui-tests/fixture-server.js',
    url: 'http://127.0.0.1:3100',
    env: { DATA_DIR: join(tmpdir(), 'sip-ui-playwright-runs'), OPENAI_API_KEY: '' },
    reuseExistingServer: false,
    timeout: 30_000
  }
});
