const { execSync } = require('child_process');

try {
    const token = execSync('gh auth token', { encoding: 'utf-8' }).trim();
    console.log("Token extraction: SUCCESS!");
    console.log("Token length:", token.length);
} catch (err) {
    console.error("Token extraction: FAILED");
    console.error(err.message);
}
