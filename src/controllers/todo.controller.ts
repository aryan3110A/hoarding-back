import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types/authenticated-request';
import todoService from '../services/todo.service';
import { ApiResponse } from '../lib/apiResponse';
import { ForbiddenError } from '../lib/errors';

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
    try {
      if (!req.user) throw new ForbiddenError('Unauthorized');
      const body = req.body || {};
      const item = await todoService.create({
        title: body.title,
        description: body.description,
        dueDate: body.dueDate,
        visibility: body.visibility,
        roleName: body.roleName,
        tags: body.tags,
        createdById: req.user.id,
      });
      res.status(201).json(ApiResponse.success(item, 'Todo item created'));
    } catch (error) {
      next(error);
    }
  }

  async update(req: AuthenticatedRequest, res: Response, next: NextFunction) {
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
        },
        {
          id: req.user.id,
          roleName: req.user.role.name,
        }
      );
      res.status(200).json(ApiResponse.success(updated, 'Todo item updated'));
    } catch (error) {
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
