import { Response, NextFunction } from 'express';
import { MaintenanceService } from '../services/maintenance.service';
import { ApiResponse } from '../lib/apiResponse';
import { AuthenticatedRequest } from '../types/authenticated-request';

const service = new MaintenanceService();

export class MaintenanceController {
  async types(_req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      res.status(200).json(ApiResponse.success(service.listTypes()));
    } catch (e) {
      next(e);
    }
  }

  async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const body = (req.body || {}) as any;
      const file = (req as any).file as { filename?: string } | undefined;
      const photoPath = file?.filename
        ? `/uploads/maintenance/${file.filename}`
        : body.photoPath
          ? String(body.photoPath)
          : undefined;

      const created = await service.create({
        hoardingId: String(body.hoardingId || ''),
        maintenanceType: String(body.maintenanceType || ''),
        maintenanceDate: String(body.maintenanceDate || ''),
        performedBy: String(body.performedBy || ''),
        remarks: body.remarks ? String(body.remarks) : undefined,
        photoUrl: photoPath,
        photoPath,
        createdById: req.user.id,
      });

      res.status(201).json(ApiResponse.success(created, 'Maintenance recorded'));
    } catch (e) {
      next(e);
    }
  }

  async listByHoarding(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { hoardingId } = req.params;
      const rows = await service.listByHoarding(String(hoardingId));
      res.status(200).json(ApiResponse.success(rows));
    } catch (e) {
      next(e);
    }
  }

  async listRecent(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const page = parseInt(String(req.query.page || 1)) || 1;
      const limit = parseInt(String(req.query.limit || 50)) || 50;
      const skip = (page - 1) * limit;
      const result = await service.listRecent({ skip, take: limit });
      res.status(200).json(ApiResponse.success(result));
    } catch (e) {
      next(e);
    }
  }
}
