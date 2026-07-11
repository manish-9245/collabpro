import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.test.ts'],
    alias: {
      '@': path.resolve(__dirname, './'),
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['app/**', 'components/**', 'lib/**'],
      exclude: [
        'app/api/**', // Exclude serverless API endpoints
        'node_modules/**',
        '**/*.d.ts',
        '**/*.config.*',
        'tests/**',
      ],
    },
  },
});
