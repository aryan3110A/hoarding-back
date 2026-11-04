import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { BadRequestError } from '../lib/errors';

const installationDir = path.resolve(process.cwd(), 'uploads', 'installation');
const supervisorChecklistDir = path.resolve(process.cwd(), 'uploads', 'supervisor-checklist');
const accountantBillsDir = path.resolve(process.cwd(), 'uploads', 'accountant-bills');

function ensureDir(dir: string) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (_) {
    // ignore
  }
}

ensureDir(installationDir);
ensureDir(supervisorChecklistDir);
ensureDir(accountantBillsDir);

const rentPaymentsDir = path.resolve(process.cwd(), 'uploads', 'rent-payments');
const maintenanceDir = path.resolve(process.cwd(), 'uploads', 'maintenance');
ensureDir(rentPaymentsDir);
ensureDir(maintenanceDir);

const storage = multer.diskStorage({
  destination: (_req: any, _file: any, cb: any) => {
    ensureDir(installationDir);
    cb(null, installationDir);
  },
  filename: (_req: any, file: any, cb: any) => {
    const safeBase = path
      .basename(file.originalname)
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 80);
    const ext = path.extname(safeBase) || '';
    const name = path.basename(safeBase, ext);
    const finalName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${name}${ext}`;
    cb(null, finalName);
  },
});

function imageFileFilter(_req: any, file: any, cb: any) {
  const mime = String(file.mimetype || '').toLowerCase();
  if (mime.startsWith('image/')) return cb(null, true);
  cb(new Error('Only image uploads are allowed'));
}

export const installationProofUpload = multer({
  storage,
  fileFilter: imageFileFilter,
  limits: { files: 10, fileSize: 10 * 1024 * 1024 },
});

const supervisorChecklistStorage = multer.diskStorage({
  destination: (_req: any, _file: any, cb: any) => {
    ensureDir(supervisorChecklistDir);
    cb(null, supervisorChecklistDir);
  },
  filename: (_req: any, file: any, cb: any) => {
    const safeBase = path
      .basename(file.originalname)
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 80);
    const ext = path.extname(safeBase) || '';
    const name = path.basename(safeBase, ext);
    const finalName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${name}${ext}`;
    cb(null, finalName);
  },
});

export const supervisorChecklistUpload = multer({
  storage: supervisorChecklistStorage,
  fileFilter: imageFileFilter,
  limits: { files: 5, fileSize: 10 * 1024 * 1024 },
});

export const supervisorExecutionUpload = multer({
  storage: supervisorChecklistStorage,
  fileFilter: imageFileFilter,
  limits: { files: 10, fileSize: 10 * 1024 * 1024 },
});

const accountantBillStorage = multer.diskStorage({
  destination: (_req: any, _file: any, cb: any) => {
    ensureDir(accountantBillsDir);
    cb(null, accountantBillsDir);
  },
  filename: (_req: any, file: any, cb: any) => {
    const safeBase = path
      .basename(file.originalname)
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 80);
    const ext = path.extname(safeBase) || '.pdf';
    const name = path.basename(safeBase, ext);
    const finalName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${name}${ext}`;
    cb(null, finalName);
  },
});

function pdfFileFilter(_req: any, file: any, cb: any) {
  const mime = String(file.mimetype || '').toLowerCase();
  const originalName = String(file.originalname || '').toLowerCase();
  if (mime === 'application/pdf' || originalName.endsWith('.pdf')) return cb(null, true);
  cb(new Error('Only PDF uploads are allowed'));
}

export const accountantBillUpload = multer({
  storage: accountantBillStorage,
  fileFilter: pdfFileFilter,
  limits: { files: 1, fileSize: 5 * 1024 * 1024 },
});

const rentPaymentStorage = multer.diskStorage({
  destination: (_req: any, _file: any, cb: any) => {
    ensureDir(rentPaymentsDir);
    cb(null, rentPaymentsDir);
  },
  filename: (_req: any, file: any, cb: any) => {
    const safeBase = path
      .basename(file.originalname)
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 80);
    const ext = path.extname(safeBase) || '';
    const name = path.basename(safeBase, ext);
    const finalName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${name}${ext}`;
    cb(null, finalName);
  },
});

export const rentPaymentUpload = multer({
  storage: rentPaymentStorage,
  fileFilter: imageFileFilter,
  limits: { files: 1, fileSize: 10 * 1024 * 1024 },
});

// ---- Task photo attachments --------------------------------------------------------------
const tasksDir = path.resolve(process.cwd(), 'uploads', 'tasks');
ensureDir(tasksDir);

export const TASK_ATTACHMENT_MAX_FILES = 10;
export const TASK_ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;
const TASK_ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const taskStorage = multer.diskStorage({
  destination: (_req: any, _file: any, cb: any) => {
    ensureDir(tasksDir);
    cb(null, tasksDir);
  },
  filename: (_req: any, file: any, cb: any) => {
    const safeBase = path
      .basename(file.originalname)
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 80);
    const ext = path.extname(safeBase) || '';
    const name = path.basename(safeBase, ext);
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${name}${ext}`);
  },
});

const taskUploadMulter = multer({
  storage: taskStorage,
  fileFilter: (_req: any, file: any, cb: any) => {
    const mime = String(file.mimetype || '').toLowerCase();
    if (TASK_ALLOWED_IMAGE_TYPES.includes(mime)) return cb(null, true);
    cb(new BadRequestError('Only JPG, PNG, WEBP or GIF photos can be attached to a task'));
  },
  limits: { files: TASK_ATTACHMENT_MAX_FILES, fileSize: TASK_ATTACHMENT_MAX_BYTES },
});

/**
 * Accepts either JSON or multipart/form-data (photos in the `images` field). File type / size /
 * count problems become clean 400 errors instead of crashing task creation.
 */
export function taskAttachmentUpload(req: any, res: any, next: any) {
  taskUploadMulter.array('images', TASK_ATTACHMENT_MAX_FILES)(req, res, (err: any) => {
    if (!err) return next();
    if (err instanceof BadRequestError) return next(err);
    if (err && err.name === 'MulterError') {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? `Each photo must be smaller than ${Math.round(TASK_ATTACHMENT_MAX_BYTES / (1024 * 1024))} MB`
          : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE'
            ? `You can upload at most ${TASK_ATTACHMENT_MAX_FILES} photos at a time`
            : 'Invalid photo upload';
      return next(new BadRequestError(message));
    }
    return next(err);
  });
}

const maintenanceStorage = multer.diskStorage({
  destination: (_req: any, _file: any, cb: any) => {
    ensureDir(maintenanceDir);
    cb(null, maintenanceDir);
  },
  filename: (_req: any, file: any, cb: any) => {
    const safeBase = path
      .basename(file.originalname)
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 80);
    const ext = path.extname(safeBase) || '';
    const name = path.basename(safeBase, ext);
    const finalName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${name}${ext}`;
    cb(null, finalName);
  },
});

export const maintenanceUpload = multer({
  storage: maintenanceStorage,
  fileFilter: imageFileFilter,
  limits: { files: 1, fileSize: 10 * 1024 * 1024 },
});
