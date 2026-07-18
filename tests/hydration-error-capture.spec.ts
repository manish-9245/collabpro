import { test, expect } from '@playwright/test';

test.describe('E2E: Ensure Zero Page Errors and Unhandled Exceptions', () => {
  let uncaughtExceptions: Error[] = [];

  test.beforeEach(() => {
    uncaughtExceptions = [];
  });

  test('React hydration and rendering exceptions must be captured and fail the test if any occur', async ({ page }) => {
    page.on('pageerror', (err) => {
      console.log(`[PAGE ERROR CAPTURED]: ${err.message}`);
      uncaughtExceptions.push(err);
    });

    await page.goto('/');
    await page.waitForTimeout(1000);

    // Assert that no unhandled browser-side exceptions or hydration errors occurred
    expect(uncaughtExceptions.length).toBe(0);
  });
});
