const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

async function upload() {
  console.log('🎬 Initializing YouTube Upload via Google API...');
  
  const oauth2Client = new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET
  );

  oauth2Client.setCredentials({
    refresh_token: process.env.YOUTUBE_REFRESH_TOKEN
  });

  const youtube = google.youtube({
    version: 'v3',
    auth: oauth2Client
  });

  const videoPath = path.resolve(__dirname, '../test-results/showcase.webm');
  if (!fs.existsSync(videoPath)) {
    console.error('❌ Video file not found at:', videoPath);
    process.exit(1);
  }

  console.log('🚀 Uploading cinematic test video of size', fs.statSync(videoPath).size, 'bytes...');

  // Parse tested functionalities dynamically
  let testedFeatures = [];
  try {
    const showcasePath = path.resolve(__dirname, '../tests/showcase.spec.ts');
    if (fs.existsSync(showcasePath)) {
      const showcaseContent = fs.readFileSync(showcasePath, 'utf8');
      const sceneMatches = showcaseContent.match(/\/\/\s*SCENE\s+\d+(\.\d+)?:\s+([^\r\n]+)/gi);
      if (sceneMatches) {
        sceneMatches.forEach(match => {
          const cleanScene = match.replace(/\/\/\s*SCENE\s+\d+(\.\d+)?:\s+/i, '').trim();
          testedFeatures.push(`🎬 ${cleanScene}`);
        });
      }
    }
  } catch (err) {
    console.warn('⚠️ Error parsing showcase test scenes:', err);
  }

  try {
    const unitDir = path.resolve(__dirname, '../tests/unit');
    if (fs.existsSync(unitDir)) {
      const files = fs.readdirSync(unitDir);
      files.forEach(file => {
        if (file.endsWith('.test.ts')) {
          const targetName = file.replace('.test.ts', '').split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
          testedFeatures.push(`🧪 Unit: ${targetName} Verification`);
        }
      });
    }
  } catch (err) {
    console.warn('⚠️ Error listing unit tests:', err);
  }

  const featuresText = testedFeatures.length > 0 
    ? `\n\nVerified Functionalities:\n${testedFeatures.map(f => `- ${f}`).join('\n')}` 
    : '';

  const dynamicDescription = `Automated E2E feature demonstration walk. Triggered by Commit: ${process.env.GITHUB_SHA || 'unknown'} - Build automated by CollabPro.${featuresText}`;

  const res = await youtube.videos.insert({
    part: 'id,snippet,status',
    requestBody: {
      snippet: {
        title: `CollabPro Cinematic E2E Tour - Branch: ${process.env.GITHUB_REF_NAME || 'main'}`,
        description: dynamicDescription,
        categoryId: '28', // Science & Technology
      },
      status: {
        privacyStatus: 'unlisted',
      },
    },
    media: {
      body: fs.createReadStream(videoPath),
    },
  });

  console.log(`✅ VIDEO_ID=${res.data.id}`);
  
  // Write the VIDEO_ID to GITHUB_OUTPUT so subsequent workflow steps can access it!
  const envFile = process.env.GITHUB_OUTPUT;
  if (envFile) {
    fs.appendFileSync(envFile, `video_id=${res.data.id}\n`);
    console.log(`📝 Appended video_id=${res.data.id} to GITHUB_OUTPUT`);
  }
}

upload().catch(err => {
  console.error('❌ Error uploading video to YouTube:', err);
  process.exit(0); // Exit with 0 so API quota errors or rate-limits do not block the pipeline
});
