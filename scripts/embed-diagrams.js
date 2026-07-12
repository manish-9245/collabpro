const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

// Read configurations
const collabproUrl = process.env.COLLABPRO_URL || 'http://localhost:3000';
const repoName = process.env.GITHUB_REPOSITORY || 'manish-9245/collabpro';
const branchName = process.env.GITHUB_REF_NAME || 'main';

const outputDir = path.join(process.cwd(), '.github', 'collabpro-diagrams');

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Fetch SVG helper
function fetchSvg(fileId) {
  return new Promise((resolve, reject) => {
    const url = `${collabproUrl}/api/export?fileId=${fileId}`;
    const client = url.startsWith('https') ? https : http;

    client.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to load diagram ${fileId}: Status ${res.statusCode}`));
        return;
      }

      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', (err) => reject(err));
  });
}

// Recursively find markdown files
function findMarkdownFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      if (file !== 'node_modules' && file !== '.git' && file !== '.next') {
        findMarkdownFiles(filePath, fileList);
      }
    } else if (file.endsWith('.md')) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

async function run() {
  console.log('🔍 Scouting workspace for CollabPro whiteboard diagram placeholders...');
  const mdFiles = findMarkdownFiles(process.cwd());
  console.log(`📂 Found ${mdFiles.length} markdown documents to parse.`);

  let totalUpdated = 0;

  for (const file of mdFiles) {
    let content = fs.readFileSync(file, 'utf8');
    const regex = /<!-- COLLABPRO_DIAGRAM:\s*([a-f0-9-]+)\s*-->/g;
    let match;
    let updated = false;

    // We collect matches to process sequentially
    const matches = [];
    while ((match = regex.exec(content)) !== null) {
      matches.push({ placeholder: match[0], id: match[1] });
    }

    for (const item of matches) {
      console.log(`📡 Fetching live SVG elements for Whiteboard ID: ${item.id}`);
      try {
        const svg = await fetchSvg(item.id);
        const svgPath = path.join(outputDir, `${item.id}.svg`);
        fs.writeFileSync(svgPath, svg, 'utf8');
        console.log(`✅ Saved vector blueprint locally to .github/collabpro-diagrams/${item.id}.svg`);

        const githubRawUrl = `https://raw.githubusercontent.com/${repoName}/${branchName}/.github/collabpro-diagrams/${item.id}.svg`;
        const embedTag = `<!-- COLLABPRO_DIAGRAM: ${item.id} -->\n![CollabPro Workspace Diagram](${githubRawUrl})`;

        content = content.replace(item.placeholder, embedTag);
        updated = true;
      } catch (e) {
        console.error(`❌ Skipped diagram ID ${item.id}: ${e.message}`);
      }
    }

    if (updated) {
      fs.writeFileSync(file, content, 'utf8');
      console.log(`💾 Updated embeds inside markdown document: ${path.basename(file)}`);
      totalUpdated++;
    }
  }

  console.log(`✨ Diagram embedding complete. Updated ${totalUpdated} markdown files.`);
}

run().catch(err => {
  console.error('Fatal embedding script error:', err);
  process.exit(1);
});
