import fs from 'fs/promises';
import { randomUUID } from 'crypto';
import { prisma } from '../lib/prisma';
import { NotFoundError, BadRequestError, ForbiddenError } from '../lib/errors';
import { Prisma } from '@prisma/client';
import { MediaStorageService, StoredImageAsset } from './mediaStorage.service';

const mediaStorage = new MediaStorageService();

export const MAX_TASK_ATTACHMENTS = 20;

export type UploadedFileLike = {
  filename?: string;
  originalname?: string;
  mimetype?: string;
  size?: number;
  path?: string;
};

export type TaskAttachment = StoredImageAsset & { id: string };

function normalizeTags(raw: unknown) {
  const text = String(raw || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
  return text.length ? text.join(', ') : null;
}

/**
 * Location link is optional. Accepts a Google Maps / any http(s) URL; a bare
 * "maps.google.com/..." gets https:// prepended. Anything else is rejected.
 */
export function normalizeLocationLink(raw: unknown): string | null {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  if (value.length > 2000) throw new BadRequestError('Location link is too long');
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new BadRequestError('Location link must be a valid URL (for example a Google Maps link)');
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.')) {
    throw new BadRequestError('Location link must be a valid http(s) URL');
  }
  return url.toString();
}

function readAttachments(raw: unknown): TaskAttachment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => !!item && typeof item === 'object')
    .map((item: any) => ({ ...item, id: String(item.id || item.filename || randomUUID()) }));
}

export class TodoService {
  /** Remove files multer already wrote to disk (used when a request is rejected afterwards). */
  async discardTempFiles(files?: UploadedFileLike[]) {
    for (const file of files || []) {
      if (file?.path) {
        try {
          await fs.unlink(file.path);
        } catch {
          // ignore
        }
      }
    }
  }

  private async storeFiles(files?: UploadedFileLike[]): Promise<TaskAttachment[]> {
    if (!files || files.length === 0) return [];
    const stored = await mediaStorage.storeTaskImages(files);
    return stored.map((asset) => ({ ...asset, id: randomUUID() }));
  }

  async list(actor: { id: string; roleName: string }) {
    const roleName = String(actor.roleName || '').toLowerCase();

    return prisma.todoItem.findMany({
      where: {
        OR: [
          { createdById: actor.id },
          { visibility: 'public' },
          {
            visibility: 'role',
            roleName: { equals: roleName, mode: 'insensitive' },
          },
        ],
      },
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });
  }

  async create(
    data: {
      title: string;
      description?: string;
      dueDate?: string | Date;
      visibility?: string;
      roleName?: string;
      tags?: string;
      locationLink?: string;
      createdById: string;
    },
    files?: UploadedFileLike[],
  ) {
    const title = String(data.title || '').trim();
    if (!title) throw new BadRequestError('Todo title is required');

    const visibility = String(data.visibility || 'private').toLowerCase();
    if (!['private', 'public', 'role'].includes(visibility)) {
      throw new BadRequestError('Visibility must be private, public, or role');
    }

    const roleName = visibility === 'role' ? String(data.roleName || '').toLowerCase() : null;
    if (visibility === 'role' && !roleName) {
      throw new BadRequestError('Role name is required when visibility is role');
    }

    const locationLink = normalizeLocationLink(data.locationLink);
    if ((files?.length || 0) > MAX_TASK_ATTACHMENTS) {
      throw new BadRequestError(`A task can have at most ${MAX_TASK_ATTACHMENTS} photos`);
    }
    const attachments = await this.storeFiles(files);

    return prisma.todoItem.create({
      data: {
        title,
        description: data.description || null,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        visibility,
        roleName,
        tags: normalizeTags(data.tags),
        locationLink,
        attachments: attachments.length ? (attachments as unknown as Prisma.InputJsonValue) : undefined,
        createdById: data.createdById,
      },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });
  }

  async update(
    id: string,
    data: {
      title?: string;
      description?: string;
      dueDate?: string | Date | null;
      status?: string;
      visibility?: string;
      roleName?: string;
      tags?: string | null;
      locationLink?: string | null;
      /** Explicit removal only: photos are never dropped just because other fields changed. */
      removeAttachmentIds?: string[];
    },
    actor: { id: string; roleName: string },
    files?: UploadedFileLike[],
  ) {
    const todo = await prisma.todoItem.findUnique({
      where: { id },
    });
    if (!todo) throw new NotFoundError('Todo not found');

    const isCreator = todo.createdById === actor.id;
    const isOwnerOrAdmin = ['owner', 'admin'].includes(String(actor.roleName || '').toLowerCase());
    const roleName = String(actor.roleName || '').toLowerCase();

    const hasAccess =
      isCreator ||
      todo.visibility === 'public' ||
      (todo.visibility === 'role' && todo.roleName?.toLowerCase() === roleName) ||
      isOwnerOrAdmin;

    if (!hasAccess) {
      throw new ForbiddenError('Not allowed to update this todo item');
    }

    const canEditDetails = isCreator || isOwnerOrAdmin;
    if (!canEditDetails && ((files?.length || 0) > 0 || (data.removeAttachmentIds?.length || 0) > 0)) {
      throw new ForbiddenError('Only the creator or an owner/admin can change task photos');
    }

    const updateData: Prisma.TodoItemUpdateInput = {};

    if (data.status) {
      const status = String(data.status).toLowerCase();
      if (!['pending', 'done'].includes(status)) {
        throw new BadRequestError('Status must be pending or done');
      }
      updateData.status = status;
    }

    let removedAssets: TaskAttachment[] = [];

    if (canEditDetails) {
      if (typeof data.title !== 'undefined') {
        const title = String(data.title || '').trim();
        if (!title) throw new BadRequestError('Todo title is required');
        updateData.title = title;
      }
      if (typeof data.description !== 'undefined') {
        updateData.description = data.description;
      }
      if (typeof data.dueDate !== 'undefined') {
        updateData.dueDate = data.dueDate ? new Date(data.dueDate) : null;
      }
      if (typeof data.visibility !== 'undefined') {
        const visibility = String(data.visibility || 'private').toLowerCase();
        if (!['private', 'public', 'role'].includes(visibility)) {
          throw new BadRequestError('Visibility must be private, public, or role');
        }
        updateData.visibility = visibility;
        updateData.roleName = visibility === 'role' ? String(data.roleName || '').toLowerCase() : null;
      }
      if (typeof data.tags !== 'undefined') {
        updateData.tags = normalizeTags(data.tags);
      }
      if (typeof data.locationLink !== 'undefined') {
        updateData.locationLink = normalizeLocationLink(data.locationLink);
      }

      // Photos: keep what is there, drop only what the user explicitly removed, append new uploads.
      const existing = readAttachments(todo.attachments);
      const removeIds = new Set((data.removeAttachmentIds || []).map((x) => String(x)));
      const kept = existing.filter((a) => !removeIds.has(String(a.id)));
      removedAssets = existing.filter((a) => removeIds.has(String(a.id)));
      if (kept.length + (files?.length || 0) > MAX_TASK_ATTACHMENTS) {
        throw new BadRequestError(`A task can have at most ${MAX_TASK_ATTACHMENTS} photos`);
      }
      const added = await this.storeFiles(files);
      if (removedAssets.length > 0 || added.length > 0) {
        const merged = [...kept, ...added];
        updateData.attachments = (
          merged.length ? (merged as unknown as Prisma.InputJsonValue) : Prisma.DbNull
        ) as any;
      }
    }

    const updated = await prisma.todoItem.update({
      where: { id },
      data: updateData,
      include: {
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    for (const asset of removedAssets) {
      await mediaStorage.deleteStoredAsset(asset);
    }
    return updated;
  }

  async delete(id: string, actor: { id: string; roleName: string }) {
    const todo = await prisma.todoItem.findUnique({
      where: { id },
    });
    if (!todo) throw new NotFoundError('Todo not found');

    const isCreator = todo.createdById === actor.id;
    const isOwnerOrAdmin = ['owner', 'admin'].includes(String(actor.roleName || '').toLowerCase());

    if (!isCreator && !isOwnerOrAdmin) {
      throw new ForbiddenError('Only the creator or an owner/admin can delete this todo item');
    }

    const deleted = await prisma.todoItem.delete({
      where: { id },
    });
    for (const asset of readAttachments(todo.attachments)) {
      await mediaStorage.deleteStoredAsset(asset);
    }
    return deleted;
  }
}

export default new TodoService();
