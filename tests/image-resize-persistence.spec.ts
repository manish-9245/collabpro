import 'dotenv/config';
import path from 'path';
import { test, expect } from '@playwright/test';

// Regression coverage for: resizing an image in the document editor, then
// navigating away and back, silently reverted to the original width.
//
// Root cause was NOT a timing/unmount race (an earlier fix for a debounced-
// save race looked plausible but didn't address the real bug). The actual
// cause: @editorjs/image's ImageTool hard-codes its internal `_data` shape
// to exactly {caption, withBorder, withBackground, stretched, file} - any
// extra key (like a custom `width`) passed into `blocks.update()` is
// silently dropped the moment the tool re-normalizes its data via its own
// `set data()`. So `editor.save()` never included width in ANY scenario,
// not just a fast navigation-away - confirmed by resizing and waiting 3s
// with zero navigation, then reading the row straight out of Postgres.
//
// Fixed by tracking width entirely outside EditorJS's data model (a sibling
// `imageWidths: {[blockId]: string}` field alongside the EditorJS document),
// see Editor.tsx's `imageWidthsRef`.

async function registerAndCreateFile(page: import('@playwright/test').Page, fileName: string) {
  const testEmail = `resize-repro-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

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
}

async function insertImageAndResizeTo50Percent(page: import('@playwright/test').Page) {
  await page.locator('[data-placeholder="Enter a Header"]').last().click();
  await page.locator('.ce-toolbar__plus').click();
  await page.locator('.ce-popover-item:has-text("Image")').click();
  await page.waitForTimeout(500);

  await page.locator('input[type="file"]').setInputFiles(path.join(__dirname, 'fixtures', 'resize-test-image.png'));
  await page.waitForTimeout(2000);

  const img = page.locator('.image-tool__image img, .image-tool img').first();
  await img.click();
  await page.waitForTimeout(300);
  await page.locator('button:has-text("50%")').click();
}

test('resizing an image and immediately navigating home and back keeps the resized width', async ({ page }) => {
  test.setTimeout(60000);

  await registerAndCreateFile(page, 'Image Resize Persistence Repro File');
  await insertImageAndResizeTo50Percent(page);

  // The actual repro: leave right away, not after the debounce would have
  // fired on its own - this is what silently dropped the resize.
  await page.locator('button[title="Back to Home"]').first().click();
  await page.waitForURL(/.*dashboard/, { timeout: 10000 });

  const fileRow = page.locator('tr:has-text("Image Resize Persistence Repro File")').first();
  await fileRow.waitFor({ state: 'visible', timeout: 15000 });
  await fileRow.click();
  await page.waitForURL(/.*workspace/, { timeout: 15000 });
  await page.waitForTimeout(1500);

  const width = await page.locator('.image-tool__image').first().evaluate((el) => (el as HTMLElement).style.width);
  expect(width).toBe('50%');
});
