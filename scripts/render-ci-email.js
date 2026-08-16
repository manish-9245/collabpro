const fs = require('fs');
const path = require('path');

// Renders .github/ci-email-template.html by substituting {{TOKEN}} placeholders
// with values read from env vars of the same name, then writes the result to
// $GITHUB_OUTPUT as a multiline `html` output for the CI notification step to
// consume. Pulled out of ci.yml (previously ~170 lines of inline HTML in the
// workflow file) so the static markup lives in one place and the workflow only
// has to supply the handful of dynamic values.
const TOKENS = [
  'JOB_STATUS',
  'STATUS_BG',
  'STATUS_BORDER',
  'STATUS_COLOR',
  'GITHUB_ACTOR',
  'GITHUB_REF_NAME',
  'GITHUB_SHA',
  'PLAYWRIGHT_COLOR',
  'PLAYWRIGHT_TEXT',
  'VIDEO_SECTION_HTML',
  'SONAR_INSIGHTS',
  'SNYK_INSIGHTS',
];

function render() {
  const templatePath = path.join(__dirname, '..', '.github', 'ci-email-template.html');
  let html = fs.readFileSync(templatePath, 'utf8');

  for (const token of TOKENS) {
    const value = process.env[token] ?? '';
    html = html.split(`{{${token}}}`).join(value);
  }

  return html;
}

function writeGithubOutput(html) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    throw new Error('GITHUB_OUTPUT is not set - this script must run as a GitHub Actions step.');
  }
  // Multiline step output: delimiter must not collide with the body content.
  const delimiter = `EOF_${Date.now()}`;
  fs.appendFileSync(outputPath, `html<<${delimiter}\n${html}\n${delimiter}\n`);
}

const rendered = render();
writeGithubOutput(rendered);
console.log(`[render-ci-email] rendered ${rendered.length} chars to $GITHUB_OUTPUT.html`);
