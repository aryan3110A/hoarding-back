import { Router } from 'express';
import { DeviceController } from '../controllers/device.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();
const deviceController = new DeviceController();

router.post('/:deviceId/ping', authenticate, deviceController.ping);
router.post('/:deviceId/checkin', authenticate, deviceController.checkin);

export default router;
