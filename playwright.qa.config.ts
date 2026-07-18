import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  workers: 1, // Enforce single worker to prevent parallel database transaction collisions
  retries: 0,
  timeout: 120000, // 3 minutes timeout per test
  
  reporter: [
    ['list']
  ],

  use: {
    baseURL: 'http://localhost:3000',
    video: {
      mode: 'on',
      size: { width: 1440, height: 900 }
    },
    viewport: { width: 1440, height: 900 },
    trace: 'on',
    screenshot: 'on',
  },

  projects: [
    {
      name: 'Chromium',
      use: { 
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 }
      },
    },
  ],
});
