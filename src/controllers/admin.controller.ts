import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types/authenticated-request';
import { runContractExpiryJob } from '../jobs/contractExpiry.job';
import { ApiResponse } from '../lib/apiResponse';

export class AdminController {
  async runContractExpiry(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      // Only allow owner/manager/admin
      const role = String(req.user.role?.name || '').toLowerCase();
      if (!['owner', 'manager', 'admin'].includes(role)) {
        return res.status(403).json(ApiResponse.error('Insufficient permissions'));
      }
      await runContractExpiryJob();
      res.status(200).json(ApiResponse.success(null, 'Contract expiry job executed'));
    } catch (err) {
      next(err);
    }
  }
}

export default new AdminController();
