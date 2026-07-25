import 'dotenv/config';
import { test, expect } from '@playwright/test';

// Regression coverage for: clicking an inserted AWS/system icon on the
// canvas crashed the whole app with "Application error: a client-side
// exception has occurred" (React error #185 - "Maximum update depth
// exceeded"). Root cause: Canvas.tsx's handleCanvasChange called
// setSelectedImageEl with a brand-new object reference on every Excalidraw
// onChange event - which fires on pure selection changes too, not just
// content edits - triggering an Excalidraw-internal re-render loop the
// instant an image element was selected. Fixed by only updating state when
// the selection/url actually changed. Plain (non-image) elements never hit
// this path at all, which is why a native rectangle never reproduced it.

async function registerAndCreateFile(page: import('@playwright/test').Page, fileName: string) {
  const testEmail = `aws-icon-repro-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

  await page.goto('/register');
  await page.locator('input[placeholder="John Doe"]').fill('Repro User');
  await page.locator('input[placeholder="name@company.com"]').fill(testEmail);
  await page.locator('input[placeholder="••••••••"]').fill('SecurePassword123!');
  await page.locator('button:has-text("Create Account")').click();
  await page.waitForURL(/.*(dashboard|teams\/create)/, { timeout: 15000 });

  try {
    await page.waitForURL(/.*teams\/create/, { timeout: 5000 });
    await page.locator('input[placeholder="Team Name"]').fill('Repro Team');
    await page.locator('button:has-text("Create Team")').click();
    await page.waitForURL(/.*dashboard/, { timeout: 15000 });
  } catch {
    // Already on dashboard, no onboarding redirect happened.
  }

  await page.goto('/dashboard');
  await page.waitForURL(/.*dashboard/, { timeout: 10000 });

  const newFileBtn = page.locator('button:has-text("New File")');
  await newFileBtn.waitFor({ state: 'visible', timeout: 15000 });
  await newFileBtn.click({ force: true });
  await page.waitForTimeout(1000);

  await page.locator('input[name="filename"]').fill(fileName);
  await page.locator('button:has-text("Create File")').click();
  await page.waitForTimeout(1500);

  const fileRow = page.locator(`tr:has-text("${fileName}")`).first();
  await fileRow.waitFor({ state: 'visible', timeout: 15000 });
  await fileRow.click();
  await page.waitForURL(/.*workspace/, { timeout: 15000 });

  await page.locator('.excalidraw__canvas').first().waitFor({ state: 'visible', timeout: 15000 });
}

test('selecting an inserted AWS icon on the canvas must not throw an uncaught client-side exception', async ({ page }) => {
  test.setTimeout(60000);

  const uncaughtExceptions: Error[] = [];
  page.on('pageerror', (err) => uncaughtExceptions.push(err));

  await registerAndCreateFile(page, 'AWS Icon Select Repro File');

  await page.getByRole('button', { name: 'AWS', exact: true }).click();
  const firstAwsIcon = page.locator('button[title^="Drag or Click to insert"]').first();
  await firstAwsIcon.waitFor({ state: 'visible', timeout: 15000 });
  await firstAwsIcon.click();
  await page.waitForTimeout(1000);

  // The actual regression: clicking the newly-placed element on the canvas
  // to select it (not the insert button in the sidebar).
  const canvas = page.locator('.excalidraw__canvas').first();
  const box = await canvas.boundingBox();
  await page.mouse.click(box!.x + 150, box!.y + 130);
  await page.waitForTimeout(2000);

  expect(uncaughtExceptions.map((e) => e.message)).toEqual([]);
});

test('clicking to insert an AWS icon (without selecting it) must not throw', async ({ page }) => {
  test.setTimeout(60000);

  const uncaughtExceptions: Error[] = [];
  page.on('pageerror', (err) => uncaughtExceptions.push(err));

  await registerAndCreateFile(page, 'AWS Icon Insert Repro File');

  await page.getByRole('button', { name: 'AWS', exact: true }).click();
  const firstAwsIcon = page.locator('button[title^="Drag or Click to insert"]').first();
  await firstAwsIcon.waitFor({ state: 'visible', timeout: 15000 });
  await firstAwsIcon.click();
  await page.waitForTimeout(2000);

  expect(uncaughtExceptions.map((e) => e.message)).toEqual([]);
});

// Differential: proves the crash is a pure client-side render bug, unrelated
// to the WS gateway (issue #186 makes the real WS connection fail with a 502
// in production - confirmed via a raw `ws` client this session). Forces the
// same failure locally and re-runs the same repro.
test('selecting an inserted AWS icon still must not throw when the WS gateway connection fails immediately (simulates #186)', async ({ page }) => {
  test.setTimeout(60000);

  const uncaughtExceptions: Error[] = [];
  page.on('pageerror', (err) => uncaughtExceptions.push(err));

  await page.routeWebSocket(/localhost:3001/, (ws) => {
    ws.close({ code: 1006, reason: 'simulated 502 - WS gateway unreachable' });
  });

  await registerAndCreateFile(page, 'AWS Icon WS Fail Repro File');

  await page.getByRole('button', { name: 'AWS', exact: true }).click();
  const firstAwsIcon = page.locator('button[title^="Drag or Click to insert"]').first();
  await firstAwsIcon.waitFor({ state: 'visible', timeout: 15000 });
  await firstAwsIcon.click();
  await page.waitForTimeout(1000);

  const canvas = page.locator('.excalidraw__canvas').first();
  const box = await canvas.boundingBox();
  await page.mouse.click(box!.x + 150, box!.y + 130);
  await page.waitForTimeout(2000);

  expect(uncaughtExceptions.map((e) => e.message)).toEqual([]);
});
