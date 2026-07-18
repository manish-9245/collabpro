import { test, expect } from '@playwright/test';
import { prisma } from '../lib/db';
import * as fs from 'fs';
import * as path from 'path';

test.describe('Group A QA Browser Test Suite', () => {
  const timestamp = Date.now();
  const testEmail = `qa_alpha_${timestamp}@collabpro.com`;
  const password = 'Password123!';
  const fullName = 'QA Agent Alpha';
  const xssTeamName = "Team <script>alert('xss_alpha')</script>";

  // Ensure screenshot directory exists
  test.beforeAll(() => {
    const screenshotDir = path.join(process.cwd(), '.context', 'ui-test-screenshots');
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
  });

  let uncaughtExceptions: Error[] = [];
  let consoleErrors: string[] = [];

  test.beforeEach(({ page }) => {
    uncaughtExceptions = [];
    consoleErrors = [];

    // Block all third-party scripts/ads to focus exclusively on local execution
    page.route('**/*', (route) => {
      const url = route.request().url();
      if (url.includes('localhost') || url.includes('127.0.0.1')) {
        route.continue();
      } else {
        route.abort();
      }
    });

    page.on('console', msg => {
      console.log(`[CONSOLE ${msg.type()}] ${msg.text()}`);
      if (msg.type() === 'error') {
        const text = msg.text();
        const ignoreList = [
          'net::ERR_',
          'Failed to load resource',
          'status of 401',
          'status of 400',
          'status of 409',
          'community libraries',
          'excalidraw',
          'Failed to fetch',
          'failed to fetch'
        ];
        const shouldIgnore = ignoreList.some(ignore => text.includes(ignore));
        if (!shouldIgnore) {
          consoleErrors.push(text);
        }
      }
    });
    page.on('pageerror', err => {
      console.log(`[PAGE ERROR] ${err.message}\nStack: ${err.stack}`);
      uncaughtExceptions.push(err);
    });
  });

  test.afterEach(() => {
    expect(uncaughtExceptions.length).toBe(0);
    expect(consoleErrors.length).toBe(0);
  });

  test.afterAll(async () => {
    // Clean database records created during test
    try {
      // Find the teams created by this user
      const teams = await prisma.team.findMany({
        where: { createdBy: testEmail }
      });
      const teamIds = teams.map(t => t.id);

      await prisma.file.deleteMany({ where: { teamId: { in: teamIds } } });
      await prisma.teamMember.deleteMany({ where: { teamId: { in: teamIds } } });
      await prisma.team.deleteMany({ where: { createdBy: testEmail } });
      await prisma.user.deleteMany({ where: { email: testEmail } });
    } catch (e) {
      console.error('Teardown cleanup error:', e);
    } finally {
      await prisma.$disconnect();
    }
  });

  test('Test 1: [Auth & Keyboard] User Registration & Logical Focus Navigation', async ({ page }) => {
    console.log('STEP: Navigate to /register');
    await page.goto('/register');
    await page.waitForLoadState('networkidle');

    // Focus on Full Name input first
    const nameInput = page.locator('input[placeholder="John Doe"]');
    const emailInput = page.locator('input[placeholder="name@company.com"]');
    const passwordInput = page.locator('input[placeholder="••••••••"]');
    const submitBtn = page.locator('button:has-text("Create Account")');

    console.log('STEP: Verify logical tab focus sequential navigation');
    await nameInput.focus();
    await expect(nameInput).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(emailInput).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(passwordInput).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(submitBtn).toBeFocused();

    // Fill form
    console.log('STEP: Filling in registration credentials');
    await nameInput.fill(fullName);
    await emailInput.fill(testEmail);
    await passwordInput.fill(password);

    // Save screenshot before creating account
    await page.screenshot({ path: '.context/ui-test-screenshots/test1-register-form.png' });

    console.log('STEP: Click Create Account');
    await submitBtn.click();

    // Verify redirected to /teams/create or /dashboard (which redirects to /teams/create)
    console.log('STEP: Waiting for routing redirection');
    await page.waitForURL(/.*(teams\/create|dashboard)/, { timeout: 30000 });

    // Save screenshot after redirection
    await page.screenshot({ path: '.context/ui-test-screenshots/test1-onboarding-redirect.png' });
    console.log('STEP_PASS|Test 1: [Auth & Keyboard] User Registration & Logical Focus Navigation|Focus ring matches tab order. Successfully redirected to onboarding.');
  });

  test('Test 2: [Adversarial Auth] Validation Conflict on Duplicate Sign-up', async ({ page }) => {
    console.log('STEP: Navigate to /register again');
    await page.goto('/register');
    await page.waitForLoadState('networkidle');

    const nameInput = page.locator('input[placeholder="John Doe"]');
    const emailInput = page.locator('input[placeholder="name@company.com"]');
    const passwordInput = page.locator('input[placeholder="••••••••"]');
    const submitBtn = page.locator('button:has-text("Create Account")');

    // Fill form with duplicate email
    console.log('STEP: Fill form with identical email');
    await nameInput.fill(fullName);
    await emailInput.fill(testEmail);
    await passwordInput.fill(password);

    console.log('STEP: Submit duplicate user form');
    await submitBtn.click();

    // Wait for the duplicate email alert/toast
    console.log('STEP: Asserting validation conflict message');
    const errorToast = page.locator('text=User with this email already exists');
    await expect(errorToast).toBeVisible({ timeout: 15000 });

    // Save screenshot of validation error
    await page.screenshot({ path: '.context/ui-test-screenshots/test2-duplicate-conflict.png' });
    console.log('STEP_PASS|Test 2: [Adversarial Auth] Validation Conflict on Duplicate Sign-up|Blocked duplicate creation and rendered User with this email already exists.');
  });

  test('Test 3: [Onboarding & Sanitization] Team Creation & XSS Sanitization', async ({ page }) => {
    // Navigate to /login to authenticate first
    console.log('STEP: Navigate to /login');
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    console.log('STEP: Logging in to establish authenticated cookie session');
    await page.fill('input[placeholder="name@company.com"]', testEmail);
    await page.fill('input[placeholder="••••••••"]', password);
    await page.click('button:has-text("Sign In")');

    // Expecting redirection to /dashboard or /teams/create
    console.log('STEP: Waiting for post-login redirect');
    await page.waitForURL(/.*(teams\/create|dashboard)/, { timeout: 15000 });

    // Ensure we are on /teams/create
    if (!page.url().includes('teams/create')) {
      console.log('STEP: Navigating to /teams/create explicitly');
      await page.goto('/teams/create');
      await page.waitForLoadState('networkidle');
    }

    const teamInput = page.locator('input[placeholder="Team Name"]');
    const submitBtn = page.locator('button:has-text("Create Team")');

    console.log('STEP: Inputting XSS payload team name');
    await teamInput.fill(xssTeamName);

    // Watch out for unexpected dialog (XSS Alert)
    let alertTriggered = false;
    page.on('dialog', async (dialog) => {
      alertTriggered = true;
      console.log(`DIALOG: Caught popup message: ${dialog.message()}`);
      await dialog.dismiss();
    });

    console.log('STEP: Wait for Create Team button to become enabled');
    await expect(submitBtn).toBeEnabled({ timeout: 10000 });

    console.log('STEP: Rapidly double-clicking Create Team');
    // Rapidly double click or double-click method
    await submitBtn.dblclick();

    // Wait for dashboard redirect
    console.log('STEP: Awaiting redirect to dashboard');
    await page.waitForURL(/.*dashboard/, { timeout: 15000 });

    // Ensure we are on the dashboard
    await expect(page).toHaveURL(/.*dashboard/);

    // Verify team name is rendered as plain text (XSS is sanitized/not executed)
    console.log('STEP: Checking safe HTML encoded rendering of team name');
    const teamNameElement = page.locator(`text="${xssTeamName}"`).first();
    await expect(teamNameElement).toBeVisible();

    // Fail test if XSS code was executed (alert was popped up)
    expect(alertTriggered).toBe(false);

    // Verify only one team is created under this email
    console.log('STEP: Querying database to verify deduplication of rapid double click');
    const teams = await prisma.team.findMany({
      where: { createdBy: testEmail }
    });
    console.log(`DATABASE: Found ${teams.length} teams created.`);
    expect(teams.length).toBe(1);

    // Save screenshot of safe dashboard
    await page.screenshot({ path: '.context/ui-test-screenshots/test3-xss-sanitization.png' });
    console.log('STEP_PASS|Test 3: [Onboarding & Sanitization] Team Creation & XSS Sanitization|XSS string rendered as safe HTML text, alert did not fire, only 1 team was created.');
  });
});
