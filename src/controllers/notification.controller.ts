import { Response, NextFunction } from 'express';
import { NotificationService } from '../services/notification.service';
import { ApiResponse } from '../lib/apiResponse';
import { AuthenticatedRequest } from '../types/authenticated-request';

const notificationService = new NotificationService();

export class NotificationController {
    async getNotifications(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const result = await notificationService.getUserNotifications(req.user!.id, req.query as any);
            res.status(200).json(ApiResponse.success(result));
        } catch (error) {
            next(error);
        }
    }

    async getUnreadCount(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const count = await notificationService.getUnreadCount(req.user!.id);
            res.status(200).json(ApiResponse.success({ count }));
        } catch (error) {
            next(error);
        }
    }

    async markAsRead(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const { id } = req.params;
            await notificationService.markAsRead(id);
            res.status(200).json(ApiResponse.success(null, 'Notification marked as read'));
        } catch (error) {
            next(error);
        }
    }
}
