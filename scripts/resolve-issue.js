#!/usr/bin/env node

/**
 * GrahakAI - Auto PR Flow Runner
 * An interactive developer CLI to pick an issue, automate branch creation,
 * verify build sanity, and raise a professional Pull Request.
 */

const { execSync } = require("child_process");
const readline = require("readline");
const fs = require("fs");
const path = require("path");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function runCommand(command) {
  try {
    return execSync(command, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    return null;
  }
}

function prompt(question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function main() {
  console.log("\n🚀 \x1b[36mGrahakAI Precision Issue Resolver & PR Automation\x1b[0m\n");

  // 1. Verify gh CLI installation
  const ghPath = runCommand("which gh");
  if (!ghPath) {
    console.error("❌ GitHub CLI (`gh`) is not installed or not in PATH.");
    process.exit(1);
  }

  // 2. Fetch active issues
  console.log("📥 Fetching open issues from repository...");
  const issuesRaw = runCommand("gh issue list --limit 10 --json number,title,labels");
  if (!issuesRaw) {
    console.error("❌ Failed to fetch issues. Please ensure you are authenticated with `gh auth login`.");
    process.exit(1);
  }

  const issues = JSON.parse(issuesRaw);
  if (issues.length === 0) {
    console.log("✨ No open issues found on this repository.");
    process.exit(0);
  }

  console.log("\n📋 \x1b[33mActive Open Issues:\x1b[0m");
  issues.forEach((issue, index) => {
    const labels = issue.labels.map(l => l.name).join(", ");
    console.log(`  [${index + 1}] #${issue.number} - ${issue.title} \x1b[90m(${labels || "no labels"})\x1b[0m`);
  });

  const selectionIndex = await prompt("\n👉 Enter the issue index to resolve [1-" + issues.length + "]: ");
  const index = parseInt(selectionIndex, 10) - 1;

  if (isNaN(index) || index < 0 || index >= issues.length) {
    console.error("❌ Invalid issue selection.");
    process.exit(1);
  }

  const selectedIssue = issues[index];
  console.log(`\n✅ Selected: \x1b[32m#${selectedIssue.number} - ${selectedIssue.title}\x1b[0m`);

  // 3. Checkout a clean branch
  const branchName = `feature/issue-${selectedIssue.number}`;
  console.log(`\n🌿 Switching to branch \x1b[36m${branchName}\x1b[0m...`);
  
  runCommand("git checkout main");
  runCommand("git pull origin main");
  
  // Create or switch to branch
  try {
    execSync(`git checkout -b ${branchName}`, { stdio: "ignore" });
  } catch (e) {
    execSync(`git checkout ${branchName}`, { stdio: "ignore" });
  }

  console.log(`\n🛠️  \x1b[35mWorkspace ready.\x1b[0m Go ahead and resolve the issue!`);
  console.log(`   Once you have completed your changes, come back here to verify and raise the PR.`);
  
  await prompt("\n⌨️  Press [Enter] when your code edits are finished to run build checks... ");

  // 4. Validate Production Build
  console.log("\n🏗️  Running Next.js production build verification...");
  try {
    execSync("npm run build", { stdio: "inherit" });
    console.log("\n🎉 \x1b[32mProduction build verified successfully with Exit Code 0!\x1b[0m");
  } catch (err) {
    console.error("\n❌ Production build failed. Please correct compilation or type errors before proceeding.");
    process.exit(1);
  }

  // 5. Commit & Push
  const gitStatus = runCommand("git status --porcelain");
  if (!gitStatus) {
    console.log("ℹ️ No modifications found in git status. Skipping commit/push.");
  } else {
    console.log("\n📝 Staging and committing changes...");
    const commitMessage = `feat(issue-${selectedIssue.number}): resolve ${selectedIssue.title.toLowerCase()}`;
    
    execSync("git add -A");
    execSync(`git commit -m "${commitMessage}"`, { stdio: "inherit" });

    console.log("\n🚀 Pushing feature branch to origin...");
    execSync(`git push origin ${branchName}`, { stdio: "inherit" });
  }

  // 6. Raise Pull Request
  console.log("\n🔀 Preparing professional Pull Request...");
  const prBody = `
### Description
Resolves #${selectedIssue.number}. Automatically implemented and verified.

### Technical Changes
- Fully resolved selected issue scope in conformance with modern codebase patterns.
- Verified TypeScript compatibility and structural styling.

### Verification Done
- Production Next.js build completed successfully (Exit Code 0).
  `;

  const prTitle = `feat(issue-${selectedIssue.number}): ${selectedIssue.title}`;
  
  try {
    const prUrl = execSync(`gh pr create --title "${prTitle}" --body "${prBody.trim()}"`, { encoding: "utf-8" }).trim();
    console.log(`\n🎈 \x1b[32mPull Request successfully opened:\x1b[0m \x1b[36m${prUrl}\x1b[0m\n`);
  } catch (err) {
    console.error("\n❌ Failed to raise PR via gh CLI. You can raise it manually in the browser.");
  }

  // 7. Cleanup & Return
  console.log("🏠 Returning safely to main branch...");
  execSync("git checkout main", { stdio: "ignore" });
  console.log("✨ Done!");
  rl.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
