import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  workers: 1, // Enforce single worker to prevent parallel database transaction collisions
  retries: 0,
  timeout: 180000, // 3 minutes timeout per test (to accommodate slow typing cinematic views)
  
  reporter: [
    ['html', { open: 'never' }],
    ['list']
  ],

  use: {
    baseURL: 'http://localhost:3000',
    
    // Video configuration for high-definition captures
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
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Launch Next.js & Standalone WS server automatically
  webServer: [
    {
      command: 'npm run dev',
      url: 'http://localhost:3000',
      reuseExistingServer: true,
      timeout: 120 * 1000,
    },
    {
      command: 'npm run ws:start',
      url: 'http://localhost:3001/health',
      reuseExistingServer: true,
      timeout: 120 * 1000,
    }
  ],
});
