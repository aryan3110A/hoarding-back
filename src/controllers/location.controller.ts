import { Response, NextFunction } from 'express';
import { LocationService } from '../services/location.service';
import { ApiResponse } from '../lib/apiResponse';
import { AuthenticatedRequest } from '../types/authenticated-request';

const locationService = new LocationService();

export class LocationController {
  async log(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw new Error('User not authenticated');
      await locationService.logLocation({
        userId: req.user.id,
        ...req.body,
        ip: req.ip,
      });
      res.status(200).json(ApiResponse.success(null, 'Location logged'));
    } catch (error) {
      next(error);
    }
  }

  async suggestions(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const q = String(req.query?.q || '').trim();
      const suggestions = await locationService.getSuggestions(q, 12);
      res.status(200).json(ApiResponse.success(suggestions));
    } catch (error) {
      next(error);
    }
  }
}
