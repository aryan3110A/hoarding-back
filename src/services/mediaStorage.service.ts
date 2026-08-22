import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { BadRequestError } from '../lib/errors';

type StorageProvider = 'local' | 'firebase';

type MulterLikeFile = {
  filename?: string;
  originalname?: string;
  mimetype?: string;
  size?: number;
  path?: string;
};

export type StoredImageAsset = {
  filename: string;
  url: string;
  image_url: string;
  storage_provider: StorageProvider;
  storage_path: string;
  original_name: string | null;
  content_type: string | null;
  size_bytes: number | null;
  uploadedAt: string;
};

type SupervisorCategory = 'checklist' | 'execution';

export class MediaStorageService {
  private getProvider(): StorageProvider {
    const provider = String(process.env.MEDIA_STORAGE_PROVIDER || 'local')
      .trim()
      .toLowerCase();
    return provider === 'firebase' ? 'firebase' : 'local';
  }

  private sanitizePathSegment(value: string) {
    return String(value || '')
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 100);
  }

  private getFirebasePrivateKey() {
    const privateKeyBase64 = String(process.env.FIREBASE_PRIVATE_KEY_BASE64 || '').trim();
    if (privateKeyBase64) {
      return Buffer.from(privateKeyBase64, 'base64').toString('utf8');
    }

    return String(process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  }

  private getFirebaseConfig() {
    const projectId = String(process.env.FIREBASE_PROJECT_ID || '').trim();
    const clientEmail = String(process.env.FIREBASE_CLIENT_EMAIL || '').trim();
    const privateKey = this.getFirebasePrivateKey().trim();
    const storageBucket = String(process.env.FIREBASE_STORAGE_BUCKET || '').trim();

    if (!projectId || !clientEmail || !privateKey || !storageBucket) {
      throw new BadRequestError(
        'Firebase Storage is not configured correctly on the server. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY or FIREBASE_PRIVATE_KEY_BASE64, and FIREBASE_STORAGE_BUCKET.',
      );
    }

    return {
      projectId,
      clientEmail,
      privateKey,
      storageBucket,
    };
  }

  private getFirebaseApp() {
    const config = this.getFirebaseConfig();
    const existing = getApps().find((app) => app.name === 'hoarding-media-storage');
    if (existing) {
      return getApp('hoarding-media-storage');
    }

    return initializeApp(
      {
        credential: cert({
          projectId: config.projectId,
          clientEmail: config.clientEmail,
          privateKey: config.privateKey,
        }),
        storageBucket: config.storageBucket,
      },
      'hoarding-media-storage',
    );
  }

  private buildFirebaseObjectPath(args: {
    hoardingId: string;
    category: SupervisorCategory;
    executionType?: 'mount' | 'remount' | 'unmount';
    filename: string;
  }) {
    const safeHoardingId = this.sanitizePathSegment(args.hoardingId) || 'unknown-hoarding';
    const safeFilename = this.sanitizePathSegment(args.filename) || `image-${Date.now()}`;
    const now = new Date();
    const year = String(now.getUTCFullYear());
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const base = `hoardings/${safeHoardingId}/supervisor/${args.category}`;
    const subtype =
      args.category === 'execution' && args.executionType
        ? `/${this.sanitizePathSegment(args.executionType) || 'mount'}`
        : '';

    return `${base}${subtype}/${year}/${month}/${safeFilename}`;
  }

  private buildFirebaseDownloadUrl(bucketName: string, objectPath: string, token: string) {
    return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`;
  }

  private async deleteTempFile(filePath?: string) {
    if (!filePath) return;

    try {
      await fs.unlink(filePath);
    } catch {
      // Ignore cleanup failures; they should not block the request.
    }
  }

  private buildLocalAsset(file: MulterLikeFile, publicUrl: string): StoredImageAsset {
    const filename = String(file.filename || path.basename(publicUrl) || `image-${Date.now()}`);
    const uploadedAt = new Date().toISOString();

    return {
      filename,
      url: publicUrl,
      image_url: publicUrl,
      storage_provider: 'local',
      storage_path: publicUrl.replace(/^\//, ''),
      original_name: file.originalname ? String(file.originalname) : null,
      content_type: file.mimetype ? String(file.mimetype) : null,
      size_bytes: typeof file.size === 'number' ? file.size : null,
      uploadedAt,
    };
  }

  private async uploadToFirebase(args: {
    hoardingId: string;
    category: SupervisorCategory;
    executionType?: 'mount' | 'remount' | 'unmount';
    file: MulterLikeFile;
  }): Promise<StoredImageAsset> {
    const firebaseApp = this.getFirebaseApp();
    const bucket = getStorage(firebaseApp).bucket();
    const filename = String(args.file.filename || args.file.originalname || `image-${Date.now()}`);
    const objectPath = this.buildFirebaseObjectPath({
      hoardingId: args.hoardingId,
      category: args.category,
      executionType: args.executionType,
      filename,
    });
    const downloadToken = randomUUID();

    if (!args.file.path) {
      throw new BadRequestError('Uploaded file path is missing for Firebase upload');
    }

    await bucket.upload(args.file.path, {
      destination: objectPath,
      metadata: {
        contentType: args.file.mimetype || 'application/octet-stream',
        cacheControl: 'public, max-age=31536000',
        metadata: {
          firebaseStorageDownloadTokens: downloadToken,
          hoardingId: args.hoardingId,
          uploadCategory: args.category,
          executionType: args.executionType || '',
          originalName: args.file.originalname || filename,
        },
      },
    });

    await this.deleteTempFile(args.file.path);

    const publicUrl = this.buildFirebaseDownloadUrl(bucket.name, objectPath, downloadToken);
    const uploadedAt = new Date().toISOString();

    return {
      filename,
      url: publicUrl,
      image_url: publicUrl,
      storage_provider: 'firebase',
      storage_path: objectPath,
      original_name: args.file.originalname ? String(args.file.originalname) : null,
      content_type: args.file.mimetype ? String(args.file.mimetype) : null,
      size_bytes: typeof args.file.size === 'number' ? args.file.size : null,
      uploadedAt,
    };
  }

  async storeSupervisorChecklistImages(hoardingId: string, files: MulterLikeFile[]) {
    const provider = this.getProvider();
    if (provider === 'firebase') {
      return Promise.all(
        files.map((file) =>
          this.uploadToFirebase({
            hoardingId,
            category: 'checklist',
            file,
          }),
        ),
      );
    }

    return files.map((file) =>
      this.buildLocalAsset(file, `/uploads/supervisor-checklist/${String(file.filename || '')}`),
    );
  }

  async storeSupervisorExecutionImages(
    hoardingId: string,
    executionType: 'mount' | 'remount' | 'unmount',
    files: MulterLikeFile[],
  ) {
    const provider = this.getProvider();
    if (provider === 'firebase') {
      return Promise.all(
        files.map((file) =>
          this.uploadToFirebase({
            hoardingId,
            category: 'execution',
            executionType,
            file,
          }),
        ),
      );
    }

    return files.map((file) =>
      this.buildLocalAsset(file, `/uploads/supervisor-checklist/${String(file.filename || '')}`),
    );
  }
}
