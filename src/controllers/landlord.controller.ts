import { Response, NextFunction } from 'express';
import { ApiResponse } from '../lib/apiResponse';
import { AuthenticatedRequest } from '../types/authenticated-request';
import landlordService from '../services/landlord.service';

export class LandlordController {
  async list(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const q = String(req.query.q || '');
      const rows = await landlordService.list({ q });
      res.status(200).json(ApiResponse.success(rows));
    } catch (error) {
      next(error);
    }
  }

  async groupedHoardings(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const q = String(req.query.q || '');
      const rows = await landlordService.listWithHoardings({ q });
      res.status(200).json(ApiResponse.success(rows));
    } catch (error) {
      next(error);
    }
  }

  async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const created = await landlordService.create(req.body || {});
      res.status(201).json(ApiResponse.success(created, 'Landlord created'));
    } catch (error) {
      next(error);
    }
  }
}

export default new LandlordController();
