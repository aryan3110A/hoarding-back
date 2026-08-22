import { Response, NextFunction } from 'express';
import { ApiResponse } from '../lib/apiResponse';
import { AuthenticatedRequest } from '../types/authenticated-request';
import blockedHoardingsService from '../services/blockedHoardings.service';

export class BlockedHoardingsController {
  async byClient(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const q = String((req.query || {}).q || '');
      const rows = await blockedHoardingsService.listByClient({ q });
      res.status(200).json(ApiResponse.success(rows, 'Blocked hoardings grouped by client'));
    } catch (error) {
      next(error);
    }
  }
}

export default new BlockedHoardingsController();
