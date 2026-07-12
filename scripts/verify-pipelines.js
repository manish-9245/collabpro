/**
 * GrahakAI Pipeline Integrity Shield
 * Programmatically queries and validates both GitHub Actions and Railway deployment pipelines.
 */

const { execSync } = require('child_process');

function runCommand(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8' }).trim();
  } catch (err) {
    return null;
  }
}

console.log('\n============================================================');
console.log('              GRAHAKAI PIPELINE INTEGRITY SHIELD            ');
console.log('============================================================');

let healthy = true;

// 1. Check GitHub Actions CI Status
let githubStatusLine = '🔴 UNKNOWN (Check Failed)';
let githubUrl = 'N/A';
try {
  const ghOutput = runCommand('gh run list --limit 1 --json status,conclusion,url');
  if (ghOutput) {
    const runs = JSON.parse(ghOutput);
    if (runs && runs.length > 0) {
      const run = runs[0];
      githubUrl = run.url;
      if (run.status === 'completed') {
        if (run.conclusion === 'success') {
          githubStatusLine = '🟢 SUCCESS (Completed)';
        } else {
          githubStatusLine = `🔴 FAILED (${run.conclusion})`;
          healthy = false;
        }
      } else {
        githubStatusLine = `🟡 IN PROGRESS (${run.status})`;
        healthy = false;
      }
    }
  }
} catch (err) {
  healthy = false;
}
console.log(`[GITHUB ACTIONS CI]  ${githubStatusLine}`);
console.log(`  URL:  ${githubUrl}\n`);

// 2. Check Railway Deployment Status
let railwayStatusLine = '🔴 UNKNOWN (Check Failed)';
let railwayId = 'N/A';
let railwayDate = 'N/A';
try {
  const rwOutput = runCommand('railway deployment list');
  if (rwOutput) {
    const lines = rwOutput.split('\n');
    const deployLine = lines.find(line => line.includes('|'));
    if (deployLine) {
      const parts = deployLine.split('|').map(p => p.trim());
      if (parts.length >= 3) {
        railwayId = parts[0];
        const status = parts[1];
        railwayDate = parts[2];
        
        if (status === 'SUCCESS') {
          railwayStatusLine = '🟢 SUCCESS (Deployed)';
        } else if (status === 'BUILDING' || status === 'INITIALIZING' || status === 'DEPLOYING') {
          railwayStatusLine = `🟡 IN PROGRESS (${status})`;
          healthy = false;
        } else {
          railwayStatusLine = `🔴 FAILED (${status})`;
          healthy = false;
        }
      }
    }
  }
} catch (err) {
  healthy = false;
}
console.log(`[RAILWAY DEPLOYMENT] ${railwayStatusLine}`);
console.log(`  ID:   ${railwayId}`);
console.log(`  Date: ${railwayDate}`);

console.log('============================================================');
if (healthy) {
  console.log('✅ ALL PRODUCTION PIPELINES ARE HEALTHY AND ACTIVE!');
  console.log('============================================================\n');
  process.exit(0);
} else {
  console.log('❌ PIPELINES ARE EITHER FAILED, BUILDING, OR UNVERIFIED.');
  console.log('============================================================\n');
  process.exit(1);
}
