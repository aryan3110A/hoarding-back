import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types/authenticated-request';
import recycleBinService from '../services/recycleBin.service';
import { ApiResponse } from '../lib/apiResponse';
import { ForbiddenError } from '../lib/errors';

export class RecycleBinController {
  private checkAccess(req: AuthenticatedRequest) {
    if (!req.user) throw new ForbiddenError('Unauthorized');
    const role = String(req.user.role?.name || '').toLowerCase();
    if (!['owner', 'admin'].includes(role)) {
      throw new ForbiddenError('Access denied: Only Owners and Admins can access the Recycle Bin');
    }
  }

  async list(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const controller = new RecycleBinController();
      controller.checkAccess(req);
      const items = await recycleBinService.list();
      res.status(200).json(ApiResponse.success(items));
    } catch (error) {
      next(error);
    }
  }

  async restore(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const controller = new RecycleBinController();
      controller.checkAccess(req);
      const { id } = req.params;
      const restored = await recycleBinService.restore(id, req.user?.id);
      res.status(200).json(ApiResponse.success(restored, 'Hoarding successfully restored from Recycle Bin'));
    } catch (error) {
      next(error);
    }
  }

  async purge(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const controller = new RecycleBinController();
      controller.checkAccess(req);
      const { id } = req.params;
      const purged = await recycleBinService.purge(id, req.user?.id);
      res.status(200).json(ApiResponse.success(purged, 'Hoarding permanently deleted'));
    } catch (error) {
      next(error);
    }
  }
}

export default new RecycleBinController();
