import 'dotenv/config';
import { test, expect } from '@playwright/test';
import { prisma } from '../lib/db';
import * as fs from 'fs';
import * as path from 'path';

// =========================================================================
// ⚙️ SCENARIO CONFIGURATION (EDIT ONLY THIS BLOCK TO MAINTAIN THE TEST)
// =========================================================================
const SCENARIO_CONFIG = {
  paths: {
    register: '/register',
    dashboard: '/dashboard',
    teamsCreate: '/teams/create',
    profile: '/dashboard/profile',
    videoDestination: 'test-results/showcase.webm'
  },
  
  selectors: {
    nameInput: 'input[placeholder="John Doe"]',
    emailInput: 'input[placeholder="name@company.com"]',
    passwordInput: 'input[placeholder="••••••••"]',
    registerBtn: 'button:has-text("Create Account")',
    teamNameInput: 'input[placeholder="Team Name"]',
    createTeamBtn: 'button:has-text("Create Team")',
    newFileBtn: 'button:has-text("New File")',
    fileInput: 'input[placeholder="Enter File Name"]',
    folderInput: 'input[placeholder="Enter Folder Name (Optional)"]',
    fileSubmitBtn: 'button:has-text("Create File")',
    canvasElement: '.excalidraw__canvas',
    awsTabBtn: 'button:has-text("AWS Icons")',
    iconSearchInput: '[data-testid="icon-search-input"]',
    awsEcsIcon: '[data-testid="aws-icon-ecs"]',
    avatarSelection: '[data-testid="avatar-selection-bubble"]',
    titleInput: 'input[placeholder="e.g. Lead System Architect, UI Designer"]',
    saveProfileBtn: 'button:has-text("Save Profile Details")'
  },

  data: {
    teamName: 'Engineering Core',
    fileName: 'AWS System Design Blueprint',
    renamedFileName: 'AWS Architecture Model - CollabPro Spec',
    folderName: 'Architecture-CollabPro',
    iconSearchTerm: 'ECS',
    editorHeadline: '# CollabPro System Architecture Blueprint',
    checklistTasks: [
      'Provision AWS ECS Fargate clusters',
      'Set up state-sync websocket endpoints (Port 3001)'
    ],
    userTitle: 'Principal System Architect'
  },

  timing: {
    humanKeystrokeDelay: 40, // Fast but visible keystroke delay
    scenePause: 1200,        // Pause between sections to make video watchable
    briefPause: 600          // Brief hover pause
  }
};

// =========================================================================
// 🎬 UNIFIED SHOWCASE RUNNER (DO NOT EDIT LOGIC BELOW UNLESS RE-ARCHITECTING)
// =========================================================================
test.describe('CollabPro Complete Feature Tour & Demonstration', () => {
  let tempVideoPath: string | undefined;
  
  // Track unique credentials to cascade delete them during teardown
  const uniqueTimestamp = Date.now();
  const testEmail = `collabpro_${uniqueTimestamp}@collabpro.com`;

  test('Execute all features sequentially, export video, and clean database', async ({ page }) => {
    page.on('console', msg => console.log(`[BROWSER LOG] ${msg.type()}: ${msg.text()}`));
    page.on('pageerror', err => console.error(`[BROWSER EXCEPTION]: ${err.stack || err.message}`));

    // Extend timeout for this comprehensive test run to 4 minutes (240000ms)
    test.setTimeout(240000);

    // Utility helpers using timing configs
    const scenePause = async () => await page.waitForTimeout(SCENARIO_CONFIG.timing.scenePause);
    const hoverAndDelay = async (locatorStr: string) => {
      try {
        const locator = page.locator(locatorStr).first();
        await locator.scrollIntoViewIfNeeded();
        await locator.hover({ timeout: 4000 });
        await page.waitForTimeout(SCENARIO_CONFIG.timing.briefPause);
      } catch (e) {
        console.warn(`⚠️ Locator hover timed out or skipped: ${locatorStr}`);
      }
    };
    const slowType = async (locatorStr: string, text: string) => {
      const locator = page.locator(locatorStr).first();
      await locator.scrollIntoViewIfNeeded();
      await locator.click();
      await page.keyboard.type(text, { delay: SCENARIO_CONFIG.timing.humanKeystrokeDelay });
      await page.waitForTimeout(200);
    };

    // ----------------------------------------------------
    // SCENE 1: Account Registration
    // ----------------------------------------------------
    console.log('🎬 Scene 1: Account Registration...');
    await page.goto(SCENARIO_CONFIG.paths.register);
    await scenePause();

    await slowType(SCENARIO_CONFIG.selectors.nameInput, 'CollabPro Engineer');
    await slowType(SCENARIO_CONFIG.selectors.emailInput, testEmail);
    await slowType(SCENARIO_CONFIG.selectors.passwordInput, 'SecurePassword123!');
    
    await hoverAndDelay(SCENARIO_CONFIG.selectors.registerBtn);
    await page.locator(SCENARIO_CONFIG.selectors.registerBtn).click();
    
    // Wait for the application to redirect (either directly to dashboard or onboarding team creation)
    await page.waitForURL(/.*(dashboard|teams\/create)/, { timeout: 15000 });
    console.log('✅ Registration completed. Redirect success!');
    await scenePause();

    // ----------------------------------------------------
    // SCENE 1.5: New Team Onboarding (If Redirected)
    // ----------------------------------------------------
    try {
      console.log('🔍 Checking for client-side team onboarding redirect...');
      await page.waitForURL(/.*teams\/create/, { timeout: 15000 });
      console.log('🎬 Scene 1.5: Onboarding Team Creation...');
      await slowType(SCENARIO_CONFIG.selectors.teamNameInput, SCENARIO_CONFIG.data.teamName);
      
      await hoverAndDelay(SCENARIO_CONFIG.selectors.createTeamBtn);
      await page.locator(SCENARIO_CONFIG.selectors.createTeamBtn).click();
      
      await page.waitForURL(/.*dashboard/, { timeout: 15000 });
      console.log('✅ Team created successfully. Transited to dashboard!');
      await scenePause();
    } catch {
      console.log('✅ No onboarding redirect active. Continuing with dashboard.');
    }

    // Force navigation to dashboard just to resolve any SPA redirect races
    await page.goto(SCENARIO_CONFIG.paths.dashboard);
    await page.waitForURL(/.*dashboard/, { timeout: 10000 });
    await scenePause();

    // ----------------------------------------------------
    // SCENE 2: Directory Folder Tree Navigation & New File
    // ----------------------------------------------------
    console.log('🎬 Scene 2: Creating File under a Folder...');
    const newFileBtnLocator = page.locator(SCENARIO_CONFIG.selectors.newFileBtn);
    await newFileBtnLocator.waitFor({ state: 'visible', timeout: 15000 });
    await hoverAndDelay(SCENARIO_CONFIG.selectors.newFileBtn);
    await newFileBtnLocator.click({ force: true });
    await page.waitForTimeout(1000);

    await slowType(SCENARIO_CONFIG.selectors.fileInput, SCENARIO_CONFIG.data.fileName);
    await slowType(SCENARIO_CONFIG.selectors.folderInput, SCENARIO_CONFIG.data.folderName);
    
    await hoverAndDelay(SCENARIO_CONFIG.selectors.fileSubmitBtn);
    await page.locator(SCENARIO_CONFIG.selectors.fileSubmitBtn).click();
    await page.waitForTimeout(1500); // Allow dialog transition to finalize

    // Locate the newly created file item row inside FileList
    console.log(`🎬 Scene 2.5: Opening file "${SCENARIO_CONFIG.data.fileName}"...`);
    const fileRow = page.locator(`tr:has-text("${SCENARIO_CONFIG.data.fileName}")`).first();
    await fileRow.waitFor({ state: 'visible', timeout: 15000 });
    await fileRow.scrollIntoViewIfNeeded();
    await fileRow.hover();
    await page.waitForTimeout(SCENARIO_CONFIG.timing.briefPause);
    await fileRow.click();
    
    // Validate workspace loaded successfully
    await page.waitForURL(/.*workspace/, { timeout: 15000 });
    console.log('✅ Workspace loaded.');
    await scenePause();

    // ----------------------------------------------------
    // SCENE 3: EditorJS Block Typing
    // ----------------------------------------------------
    console.log('🎬 Scene 3: Generating Rich Markdown Document...');
    try {
      const editor = page.locator('.ce-paragraph').first();
      await editor.waitFor({ state: 'visible', timeout: 15000 });
      await editor.click({ timeout: 5000 });
      await page.keyboard.type(SCENARIO_CONFIG.data.editorHeadline, { delay: SCENARIO_CONFIG.timing.humanKeystrokeDelay });
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);

      // Dynamic block command simulation
      await page.keyboard.type('/checklist', { delay: 100 });
      await page.waitForTimeout(1000);
      await page.keyboard.press('Enter');
      
      for (const task of SCENARIO_CONFIG.data.checklistTasks) {
        await page.keyboard.type(task, { delay: SCENARIO_CONFIG.timing.humanKeystrokeDelay });
        await page.keyboard.press('Enter');
        await page.waitForTimeout(400);
      }
    } catch (editorError) {
      console.warn('⚠️ Editor interactions encountered lag, skipping to maintain timeline.', editorError);
    }
    await scenePause();

    // ----------------------------------------------------
    // SCENE 4: Whiteboard Canvas & Sidebar Loading
    // ----------------------------------------------------
    console.log('🎬 Scene 4: Interacting with Whiteboard Canvas...');
    try {
      const awsTab = page.locator(SCENARIO_CONFIG.selectors.awsTabBtn).first();
      if (await awsTab.isVisible()) {
        await awsTab.click();
        await page.waitForTimeout(1000);
        await slowType(SCENARIO_CONFIG.selectors.iconSearchInput, SCENARIO_CONFIG.data.iconSearchTerm);
        await page.waitForTimeout(1000);

        const ecsIcon = page.locator(SCENARIO_CONFIG.selectors.awsEcsIcon).first();
        const canvas = page.locator(SCENARIO_CONFIG.selectors.canvasElement).first();
        const canvasBox = await canvas.boundingBox();

        if (canvasBox && await ecsIcon.isVisible()) {
          await ecsIcon.dragTo(canvas, {
            targetPosition: { x: canvasBox.width / 2, y: canvasBox.height / 2 }
          });
        }
      }
    } catch (canvasError) {
      console.warn('⚠️ Canvas interaction timed out or skipped.', canvasError);
    }
    await scenePause();

    // ----------------------------------------------------
    // SCENE 5: Settings and Profile Updates
    // ----------------------------------------------------
    console.log('🎬 Scene 5: Adjusting Profile Settings...');
    await page.goto(SCENARIO_CONFIG.paths.profile);
    await page.waitForURL(/.*profile/, { timeout: 15000 });
    await scenePause();

    try {
      // Find anime avatar from the grid selection
      const avatarBtn = page.locator('button[title^="Gojo Satoru"]').first();
      if (await avatarBtn.isVisible()) {
        await avatarBtn.hover();
        await page.waitForTimeout(500);
        await avatarBtn.click();
        await page.waitForTimeout(1000);
      }

      await slowType(SCENARIO_CONFIG.selectors.titleInput, SCENARIO_CONFIG.data.userTitle);
      await hoverAndDelay(SCENARIO_CONFIG.selectors.saveProfileBtn);
      await page.locator(SCENARIO_CONFIG.selectors.saveProfileBtn).click();
      await page.waitForTimeout(1500);
    } catch (settingsError) {
      console.warn('⚠️ Profile settings adjustment skipped.', settingsError);
    }
    await scenePause();

    // ----------------------------------------------------
    // SCENE 6: Dynamic File Renaming Flow
    // ----------------------------------------------------
    console.log('🎬 Scene 6: Executing File Renaming Flow...');
    await page.goto(SCENARIO_CONFIG.paths.dashboard);
    await page.waitForTimeout(1000);

    const initialRow = page.locator(`tr:has-text("${SCENARIO_CONFIG.data.fileName}")`).first();
    await initialRow.waitFor({ state: 'visible', timeout: 15000 });
    await initialRow.scrollIntoViewIfNeeded();
    await initialRow.hover();
    await page.waitForTimeout(400);

    // Open Dropdown menu
    const initialMoreBtn = initialRow.locator('button').first();
    await initialMoreBtn.click();
    await page.waitForTimeout(500);

    // Click "Rename File" item in the menu
    const renameMenuItem = page.locator('div[role="menuitem"]:has-text("Rename File")').first();
    await renameMenuItem.click();
    await page.waitForTimeout(500);

    // Enter new name and click Rename submit
    const renameInput = page.locator('input[placeholder="File name"]').first();
    await renameInput.fill('');
    await page.waitForTimeout(300);
    await renameInput.type(SCENARIO_CONFIG.data.renamedFileName, { delay: SCENARIO_CONFIG.timing.humanKeystrokeDelay });
    await page.waitForTimeout(500);

    const renameSubmitBtn = page.locator('button:has-text("Rename")').first();
    await renameSubmitBtn.click();
    
    // Wait for the rename dialog to be fully dismissed and the backdrop to clear
    await page.locator('div[role="dialog"]').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    
    // Settle DOM and pointer-events, manually force pointer-events to auto on html/body if Radix UI failed to clean up
    await page.evaluate(() => {
      document.documentElement.style.pointerEvents = 'auto';
      document.body.style.pointerEvents = 'auto';
    }).catch(() => {});
    await page.waitForTimeout(1000);
    
    console.log('✅ File renamed successfully.');
    await scenePause();

    // ----------------------------------------------------
    // SCENE 7: Dynamic File Deletion Flow
    // ----------------------------------------------------
    console.log('🎬 Scene 7: Executing File Deletion Flow...');
    const renamedRow = page.locator(`tr:has-text("${SCENARIO_CONFIG.data.renamedFileName}")`).first();
    await renamedRow.waitFor({ state: 'visible', timeout: 15000 });
    await renamedRow.scrollIntoViewIfNeeded();
    await renamedRow.hover({ force: true });
    await page.waitForTimeout(400);

    // Open Dropdown menu for the renamed item
    const renamedMoreBtn = renamedRow.locator('button').first();
    await renamedMoreBtn.click();
    await page.waitForTimeout(500);

    // Click "Delete Permanently" item
    const deleteMenuItem = page.locator('div[role="menuitem"]:has-text("Delete Permanently")').first();
    await deleteMenuItem.click();
    await page.waitForTimeout(500);

    // Click confirmation "Delete Permanently" button
    const deleteConfirmBtn = page.locator('button:has-text("Delete Permanently")').first();
    await deleteConfirmBtn.click();
    
    // Verify file has successfully disappeared from list
    await expect(renamedRow).not.toBeVisible({ timeout: 10000 });
    console.log('✅ File deleted successfully.');
    await scenePause();

    console.log('🎬 All scenes complete. Finalizing recording gracefully.');
    tempVideoPath = await page.video()?.path();
  });

  // =========================================================================
  // 🧹 AFTER ALL: Video compilation AND database purge
  // =========================================================================
  test.afterAll(async () => {
    // 1. Export the video file
    if (tempVideoPath) {
      const destinationFile = path.resolve(SCENARIO_CONFIG.paths.videoDestination);
      const destinationFileDir = path.dirname(destinationFile);
      
      if (!fs.existsSync(destinationFileDir)) {
        fs.mkdirSync(destinationFileDir, { recursive: true });
      }
      
      fs.copyFileSync(tempVideoPath, destinationFile);
      console.log(`\n=================================================`);
      console.log(`🎥 SINGLE VIDEO GENERATED SUCCESSFULLY!`);
      console.log(`📂 Location: ${destinationFile}`);
      console.log(`=================================================\n`);
    }

    // 2. Perform zero-bloat database cleanup of test records
    try {
      console.log(`\n🧹 Initiating Database Cleanup for test account: ${testEmail}...`);
      
      // Step A: Find and delete files created by the test user
      const testFiles = await prisma.file.findMany({
        where: { createdBy: testEmail },
        select: { id: true }
      });
      const fileIds = testFiles.map(f => f.id);

      if (fileIds.length > 0) {
        // Purge file versions & active co-presence presence models
        await prisma.fileVersion.deleteMany({ where: { fileId: { in: fileIds } } });
        await prisma.filePresence.deleteMany({ where: { fileId: { in: fileIds } } });
        await prisma.file.deleteMany({ where: { id: { in: fileIds } } });
        console.log(`🗑️ Deleted ${fileIds.length} file records and related versions/presence.`);
      }

      // Step B: Purge invitations, notifications, API keys and team memberships
      const inviteDeleted = await prisma.invitation.deleteMany({
        where: {
          OR: [{ inviteeEmail: testEmail }, { inviterEmail: testEmail }]
        }
      });
      const notifDeleted = await prisma.notification.deleteMany({ where: { userEmail: testEmail } });
      const apiKeyDeleted = await prisma.apiKey.deleteMany({ where: { userEmail: testEmail } });
      const membersDeleted = await prisma.teamMember.deleteMany({ where: { userEmail: testEmail } });
      
      console.log(`🗑️ Cleaned notifications (${notifDeleted.count}), invitations (${inviteDeleted.count}), API keys (${apiKeyDeleted.count}), and team members (${membersDeleted.count}).`);

      // Step C: Delete teams created by this user
      const teamsDeleted = await prisma.team.deleteMany({ where: { createdBy: testEmail } });
      console.log(`🗑️ Deleted ${teamsDeleted.count} teams.`);

      // Step D: Delete the core user record
      const userDeleted = await prisma.user.deleteMany({ where: { email: testEmail } });
      console.log(`🗑️ Deleted test User account record (${userDeleted.count}).`);

      console.log('✅ Database fully cleared. Pre-test pristine state restored!');
    } catch (dbError) {
      console.error('❌ Database cleanup encountered an error: ', dbError);
    } finally {
      await prisma.$disconnect();
    }
  });
});
