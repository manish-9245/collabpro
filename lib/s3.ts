import { 
  S3Client, 
  PutObjectCommand, 
  CreateBucketCommand, 
  HeadBucketCommand,
  PutBucketPolicyCommand
} from "@aws-sdk/client-s3";

// Instantiate the S3 client lazily
let s3ClientInstance: S3Client | null = null;

export function getS3Client(): S3Client {
  if (s3ClientInstance) return s3ClientInstance;

  const endpoint = process.env.S3_ENDPOINT;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error("Missing S3 / MinIO environment variables configuration.");
  }

  s3ClientInstance = new S3Client({
    endpoint,
    region: "us-east-1",
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    forcePathStyle: true, // Required for MinIO
  });

  return s3ClientInstance;
}

/**
 * Ensures the S3/MinIO bucket exists and is configured for public read access.
 */
async function ensureBucketExists(client: S3Client, bucketName: string) {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucketName }));
    console.log(`[S3 Utility] Bucket "${bucketName}" already exists.`);
  } catch (err: any) {
    // If the bucket doesn't exist, create it
    if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
      console.log(`[S3 Utility] Bucket "${bucketName}" not found. Creating it...`);
      await client.send(new CreateBucketCommand({ Bucket: bucketName }));
      console.log(`[S3 Utility] Bucket "${bucketName}" created successfully.`);

      // Apply a public read policy to the bucket so that the browser can load the images
      const publicPolicy = {
        Version: "2012-10-17",
        Statement: [
          {
            Sid: "PublicReadGetObject",
            Effect: "Allow",
            Principal: "*",
            Action: ["s3:GetObject"],
            Resource: [`arn:aws:s3:::${bucketName}/*`],
          },
        ],
      };

      await client.send(
        new PutBucketPolicyCommand({
          Bucket: bucketName,
          Policy: JSON.stringify(publicPolicy),
        })
      );
      console.log(`[S3 Utility] Public read policy successfully applied to bucket "${bucketName}".`);
    } else {
      throw err;
    }
  }
}

/**
 * Uploads a file buffer to the S3-compatible MinIO bucket.
 * Returns the public URL of the uploaded image.
 */
export async function uploadToS3(
  buffer: Uint8Array, 
  filename: string, 
  mimeType: string
): Promise<string> {
  const client = getS3Client();
  const bucketName = process.env.S3_BUCKET_NAME || "collabpro-images";

  // 1. Ensure the bucket exists and is public
  await ensureBucketExists(client, bucketName);

  // 2. Sanitize and generate unique filename
  const sanitizedName = filename.replace(/[^a-zA-Z0-9.-]/g, "_");
  const uniqueKey = `${Date.now()}_${sanitizedName}`;

  console.log(`[S3 Utility] Uploading ${uniqueKey} (${buffer.byteLength} bytes) to bucket "${bucketName}"...`);

  // 3. Upload object
  await client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: uniqueKey,
      Body: buffer,
      ContentType: mimeType,
    })
  );

  // 4. Construct S3 public URL
  const endpoint = process.env.S3_ENDPOINT!.replace(/\/$/, "");
  const publicUrl = `${endpoint}/${bucketName}/${uniqueKey}`;
  
  console.log(`[S3 Utility] Upload completed successfully. Public URL: ${publicUrl}`);
  return publicUrl;
}
