import { Response, NextFunction } from 'express';
import { ApiResponse } from '../lib/apiResponse';
import { AuthenticatedRequest } from '../types/authenticated-request';
import categoryService from '../services/category.service';

export class CategoryController {
  async list(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const rows = await categoryService.list();
      res.status(200).json(ApiResponse.success(rows));
    } catch (error) {
      next(error);
    }
  }

  async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const created = await categoryService.create({
        name: (req.body || {}).name,
        actorRole: req.user.role?.name,
      });
      res.status(201).json(ApiResponse.success(created, 'Category created'));
    } catch (error) {
      next(error);
    }
  }
}

export default new CategoryController();
