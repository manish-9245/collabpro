const fs = require('fs');
const path = require('path');

const hookPath = path.join(__dirname, '..', '.git', 'hooks', 'pre-push');

const hookContent = `#!/bin/sh
# CollabPro Git Pre-Push Guardrail Hook
# Aborts push if local compilation or linting fails.

echo "🔍 Running pre-push guardrail checks..."

# Run linting
echo "⏳ Checking code style & linting..."
npm run lint
if [ $? -ne 0 ]; then
  echo "❌ Push aborted: Linting checks failed. Fix the issues before pushing."
  exit 1
fi

# Run compilation
echo "⏳ Verifying local production build..."
npm run build
if [ $? -ne 0 ]; then
  echo "❌ Push aborted: Local production compilation failed. Check build logs."
  exit 1
fi

echo "✅ All guardrail checks passed! Proceeding with push..."
exit 0
`;

try {
  const hooksDir = path.dirname(hookPath);
  if (!fs.existsSync(hooksDir)) {
    fs.mkdirSync(hooksDir, { recursive: true });
  }

  fs.writeFileSync(hookPath, hookContent, { mode: 0o755 });
  console.log('✅ Local pre-push guardrail hooks installed successfully inside .git/hooks/pre-push!');
} catch (error) {
  console.error('⚠️ Failed to install git hooks:', error.message);
}
