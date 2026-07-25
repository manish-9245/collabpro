import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    fileParallelism: false,
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
        'node_modules/**',
        '**/*.d.ts',
        '**/*.config.*',
        'tests/**',
      ],
      // Floor set just below the measured baseline (see PR description for the
      // before/after numbers) so coverage of app/api/** — where authorization
      // checks live — can't silently regress now that it's actually measured.
      thresholds: {
        lines: 16,
        functions: 11,
        branches: 13,
        statements: 16,
      },
    },
  },
});
