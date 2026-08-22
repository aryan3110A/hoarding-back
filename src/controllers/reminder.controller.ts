import { Response, NextFunction } from 'express';
import { ReminderJob } from '../jobs/reminder.job';
import { ApiResponse } from '../lib/apiResponse';
import { AuthenticatedRequest } from '../types/authenticated-request';

const reminderJob = new ReminderJob();

export class ReminderController {
    async sendReminders(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            // Allow overriding days from body, default to 7
            const days = req.body.days ? parseInt(req.body.days) : 7;
            const result = await reminderJob.sendRentReminders(days);
            res.status(200).json(ApiResponse.success(result, 'Reminders triggered successfully'));
        } catch (error) {
            next(error);
        }
    }
}
