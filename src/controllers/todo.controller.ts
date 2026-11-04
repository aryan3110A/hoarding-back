import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types/authenticated-request';
import todoService from '../services/todo.service';
import { ApiResponse } from '../lib/apiResponse';
import { ForbiddenError } from '../lib/errors';

const filesOf = (req: AuthenticatedRequest) =>
  ((req as unknown as { files?: unknown }).files as any[] | undefined) || [];

/** multipart bodies deliver everything as strings; accept JSON array, CSV or repeated fields. */
function parseIdList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((x) => String(x)).filter(Boolean);
  const text = String(raw ?? '').trim();
  if (!text) return [];
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed.map((x) => String(x)).filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return text
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

export class TodoController {
  async list(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw new ForbiddenError('Unauthorized');
      const items = await todoService.list({
        id: req.user.id,
        roleName: req.user.role.name,
      });
      res.status(200).json(ApiResponse.success(items));
    } catch (error) {
      next(error);
    }
  }

  async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    const files = filesOf(req);
    try {
      if (!req.user) throw new ForbiddenError('Unauthorized');
      const body = req.body || {};
      const item = await todoService.create(
        {
          title: body.title,
          description: body.description,
          dueDate: body.dueDate,
          visibility: body.visibility,
          roleName: body.roleName,
          tags: body.tags,
          locationLink: body.locationLink,
          createdById: req.user.id,
        },
        files,
      );
      res.status(201).json(ApiResponse.success(item, 'Todo item created'));
    } catch (error) {
      await todoService.discardTempFiles(files);
      next(error);
    }
  }

  async update(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    const files = filesOf(req);
    try {
      if (!req.user) throw new ForbiddenError('Unauthorized');
      const { id } = req.params;
      const body = req.body || {};
      const updated = await todoService.update(
        id,
        {
          title: body.title,
          description: body.description,
          dueDate: body.dueDate,
          status: body.status,
          visibility: body.visibility,
          roleName: body.roleName,
          tags: body.tags,
          locationLink: body.locationLink,
          removeAttachmentIds: parseIdList(body.removeAttachmentIds),
        },
        {
          id: req.user.id,
          roleName: req.user.role.name,
        },
        files,
      );
      res.status(200).json(ApiResponse.success(updated, 'Todo item updated'));
    } catch (error) {
      await todoService.discardTempFiles(files);
      next(error);
    }
  }

  async delete(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw new ForbiddenError('Unauthorized');
      const { id } = req.params;
      await todoService.delete(id, {
        id: req.user.id,
        roleName: req.user.role.name,
      });
      res.status(200).json(ApiResponse.success(null, 'Todo item deleted'));
    } catch (error) {
      next(error);
    }
  }
}

export default new TodoController();
