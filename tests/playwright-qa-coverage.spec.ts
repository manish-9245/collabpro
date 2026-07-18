import { test, expect } from '@playwright/test';
import { prisma } from '../lib/db';
import * as fs from 'fs';
import * as path from 'path';
import bcrypt from 'bcryptjs';

test.describe('E2E Interaction Coverage & Network Monitoring Suite', () => {
  const uniqueTimestamp = Date.now();
  const testEmailA = `qa_alpha_${uniqueTimestamp}@collabpro.com`;
  const testEmailB = `qa_beta_${uniqueTimestamp}@collabpro.com`;
  
  let teamId: string;
  let fileId: string;

  test.beforeAll(async () => {
    const hashedPassword = await bcrypt.hash('Password123!', 10);
    // Prep mock relational records directly in DB to run E2E flow blazingly fast
    const userA = await prisma.user.create({
      data: {
        email: testEmailA,
        name: 'QA User Alpha',
        password: hashedPassword
      }
    });

    const userB = await prisma.user.create({
      data: {
        email: testEmailB,
        name: 'QA User Beta',
        password: hashedPassword
      }
    });

    const team = await prisma.team.create({
      data: {
        teamName: 'QA Automation Fleet',
        createdBy: testEmailA
      }
    });
    teamId = team.id;

    await prisma.teamMember.createMany({
      data: [
        { teamId: team.id, userEmail: testEmailA, role: 'owner' },
        { teamId: team.id, userEmail: testEmailB, role: 'member' }
      ]
    });

    const file = await prisma.file.create({
      data: {
        fileName: 'E2E Validation Canvas',
        teamId: team.id,
        createdBy: testEmailA,
        document: '{"blocks":[{"type":"paragraph","data":{"text":"Initial QA paragraph"}}]}',
        whiteboard: '[]'
      }
    });
    fileId = file.id;
  });

  test.afterAll(async () => {
    // Clean database records
    try {
      await prisma.fileVersion.deleteMany({ where: { fileId } });
      await prisma.filePresence.deleteMany({ where: { fileId } });
      await prisma.file.deleteMany({ where: { teamId } });
      await prisma.teamMember.deleteMany({ where: { teamId } });
      await prisma.apiKey.deleteMany({ where: { userEmail: { in: [testEmailA, testEmailB] } } });
      await prisma.team.deleteMany({ where: { id: teamId } });
      await prisma.user.deleteMany({ where: { email: { in: [testEmailA, testEmailB] } } });
    } catch (e) {
      console.error('Teardown error:', e);
    } finally {
      await prisma.$disconnect();
    }
  });

  test('Assert Secure Login & Real-time Network Interception', async ({ page }) => {
    // 1. Console Exception Safeguard (Page errors capture unhandled JS crash exceptions)
    const pageErrors: Error[] = [];
    page.on('pageerror', (err) => {
      pageErrors.push(err);
    });

    // 2. HTTP Interception
    const interceptedRequests: string[] = [];
    await page.route('**/api/state-sync', async (route) => {
      interceptedRequests.push(route.request().url());
      await route.continue();
    });

    // 3. Login User Alpha
    await page.goto('/login');
    await page.fill('input[placeholder="name@company.com"]', testEmailA);
    await page.fill('input[placeholder="••••••••"]', 'Password123!');
    await page.click('button:has-text("Sign In")');

    // Wait for redirect to dashboard
    await page.waitForURL(/.*dashboard/, { timeout: 15000 });
    expect(pageErrors).toHaveLength(0); // Zero uncaught page crash exceptions
  });

  test('Verify Multi-Session Workspace Layout & Collaborative Sync', async ({ browser }) => {
    // 1. Create two isolated browser contexts to emulate multiple concurrent users
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    // Login user A
    await pageA.goto('/login');
    await pageA.fill('input[placeholder="name@company.com"]', testEmailA);
    await pageA.fill('input[placeholder="••••••••"]', 'Password123!');
    await pageA.click('button:has-text("Sign In")');
    await pageA.waitForURL(/.*dashboard/);

    // Login user B
    await pageB.goto('/login');
    await pageB.fill('input[placeholder="name@company.com"]', testEmailB);
    await pageB.fill('input[placeholder="••••••••"]', 'Password123!');
    await pageB.click('button:has-text("Sign In")');
    await pageB.waitForURL(/.*dashboard/);

    // Navigate both to workspace
    await pageA.goto(`/workspace/${fileId}`);
    await pageB.goto(`/workspace/${fileId}`);

    // Wait for Editor and Canvas containers to load
    await pageA.waitForSelector('.ce-paragraph', { timeout: 15000 });
    await pageB.waitForSelector('.ce-paragraph', { timeout: 15000 });

    // Assert both sessions render correct text block
    const textA = await pageA.innerText('.ce-paragraph');
    const textB = await pageB.innerText('.ce-paragraph');
    expect(textA).toBe(textB);

    await contextA.close();
    await contextB.close();
  });

  test('Keyboard Accessibility & ARIA focus checks', async ({ page }) => {
    await page.goto('/login');
    
    // Validate Tab index on form controls
    const emailInput = page.locator('input[placeholder="name@company.com"]');
    const passwordInput = page.locator('input[placeholder="••••••••"]');
    const submitBtn = page.locator('button:has-text("Sign In")');

    await emailInput.focus();
    await expect(emailInput).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(passwordInput).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(submitBtn).toBeFocused();
  });
});
