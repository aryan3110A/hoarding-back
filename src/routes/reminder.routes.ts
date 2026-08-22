import { Router } from 'express';
import { ReminderController } from '../controllers/reminder.controller';
import { authenticate } from '../middleware/auth.middleware';
import { authorize } from '../middleware/rbac.middleware';

const router = Router();
const reminderController = new ReminderController();

router.use(authenticate);

// Manual trigger for reminders (Owner/Manager only)
router.post(
    '/send',
    authorize(['admin', 'owner', 'manager']),
    reminderController.sendReminders
);

export default router;
