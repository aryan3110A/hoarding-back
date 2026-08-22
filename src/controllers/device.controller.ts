import { Request, Response, NextFunction } from 'express';
import { DeviceService } from '../services/device.service';
import { ApiResponse } from '../lib/apiResponse';
import { AuthenticatedRequest } from '../types/authenticated-request';

const deviceService = new DeviceService();

export class DeviceController {
  async ping(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw new Error('User not authenticated');
      const { deviceId } = req.params;
      await deviceService.ping(req.user.id, deviceId, { ...req.body, ip: req.ip });
      res.status(200).json(ApiResponse.success(null, 'Ping received'));
    } catch (error) {
      next(error);
    }
  }

  async checkin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw new Error('User not authenticated');
      const { deviceId } = req.params;
      await deviceService.checkin(deviceId, req.user.id, { ...req.body, ip: req.ip });
      res.status(200).json(ApiResponse.success(null, 'Check-in successful'));
    } catch (error) {
      next(error);
    }
  }
}
