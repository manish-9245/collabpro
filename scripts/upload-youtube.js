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
  const res = await youtube.videos.insert({
    part: 'id,snippet,status',
    requestBody: {
      snippet: {
        title: `CollabPro Cinematic E2E Tour - Branch: ${process.env.GITHUB_REF_NAME || 'main'}`,
        description: `Automated E2E feature demonstration walk. Triggered by Commit: ${process.env.GITHUB_SHA || 'unknown'} - Build automated by GrahakAI`,
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
