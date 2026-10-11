import { prisma } from '../lib/prisma';
import { NotFoundError, BadRequestError, ForbiddenError } from '../lib/errors';
import { Prisma } from '@prisma/client';

function normalizeTags(raw: unknown) {
  const text = String(raw || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
  return text.length ? text.join(', ') : null;
}

export class TodoService {
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

  async create(data: {
    title: string;
    description?: string;
    dueDate?: string | Date;
    visibility?: string;
    roleName?: string;
    tags?: string;
    createdById: string;
  }) {
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

    return prisma.todoItem.create({
      data: {
        title,
        description: data.description || null,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        visibility,
        roleName,
        tags: normalizeTags(data.tags),
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
    },
    actor: { id: string; roleName: string }
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

    const updateData: Prisma.TodoItemUpdateInput = {};

    if (data.status) {
      const status = String(data.status).toLowerCase();
      if (!['pending', 'done'].includes(status)) {
        throw new BadRequestError('Status must be pending or done');
      }
      updateData.status = status;
    }

    if (isCreator || isOwnerOrAdmin) {
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
    }

    return prisma.todoItem.update({
      where: { id },
      data: updateData,
      include: {
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });
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

    return prisma.todoItem.delete({
      where: { id },
    });
  }
}

export default new TodoService();
