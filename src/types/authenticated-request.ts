import { Request } from 'express';
import { User, RefreshSession } from '@prisma/client';

/** A lightweight alias for uploaded file shape; keep `any` to avoid requiring @types/multer in build environment */
export type UploadedFile = any;

export interface AuthenticatedRequest extends Request {
  user?: User & { role: { name: string }; territories?: { territory: { city: string | null } }[] };
  session?: RefreshSession;
  sessionId?: string;
  /** Multer populates `req.files` as either an array or a field->array map. Use `any`-based types to remain compatible with varying environments. */
  files?: any[] | { [fieldname: string]: any[] };
}
