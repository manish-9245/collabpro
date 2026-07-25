import { prisma as defaultPrisma } from "@/lib/db";
import { uploadToS3 } from "@/lib/s3";
import fs from "fs";
import path from "path";

// Repository Interface & Implementation (Dependency Inversion & Single Responsibility)
export interface IUploadRepository {
  createUpload(filename: string, mimeType: string, payload: string): Promise<any>;
}

export class UploadRepository implements IUploadRepository {
  private db: any;

  constructor(db: any = defaultPrisma) {
    this.db = db;
  }

  async createUpload(filename: string, mimeType: string, payload: string) {
    return this.db.uploadedFile.create({
      data: {
        filename,
        mimeType,
        payload,
      },
    });
  }
}

// Storage Interface & Implementations (Interface Segregation & Open-Closed & Single Responsibility)
export interface IStorageService {
  store(filename: string, mimeType: string, content: Uint8Array, contentDisposition?: string): Promise<string>;
}

export class S3StorageService implements IStorageService {
  async store(filename: string, mimeType: string, content: Uint8Array, contentDisposition?: string): Promise<string> {
    // contentDisposition is set at upload time (rather than relying on serve-time headers)
    // because S3-backed downloads are served via a direct redirect to the object URL,
    // which bypasses any headers our own API route would otherwise set (issue #195).
    return uploadToS3(content, filename, mimeType, contentDisposition);
  }
}

export class LocalStorageService implements IStorageService {
  async store(filename: string, mimeType: string, content: Uint8Array, _contentDisposition?: string): Promise<string> {
    const uploadDir = path.join(process.cwd(), "public/uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const uniqueFilename = `${Date.now()}_${filename}`;
    const filePath = path.join(uploadDir, uniqueFilename);
    
    // Write synchronously to local filesystem
    fs.writeFileSync(filePath, content);
    
    // Return base64 payload representation for database persistence fallback
    return Buffer.from(content).toString("base64");
  }
}

// Upload Manager coordination service
export class UploadService {
  private repo: IUploadRepository;
  private storage: IStorageService;

  constructor(repo: IUploadRepository, storage: IStorageService) {
    this.repo = repo;
    this.storage = storage;
  }

  async handleUpload(filename: string, mimeType: string, content: Uint8Array, contentDisposition?: string): Promise<any> {
    // Only pass a 4th argument through when a caller actually provided one, to preserve
    // the pre-existing 3-arg calling convention for callers/tests that don't care about it.
    const payload = contentDisposition !== undefined
      ? await this.storage.store(filename, mimeType, content, contentDisposition)
      : await this.storage.store(filename, mimeType, content);
    const record = await this.repo.createUpload(filename, mimeType, payload);
    return record;
  }
}
