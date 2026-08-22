import { Router } from 'express';
import { LocationController } from '../controllers/location.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();
const locationController = new LocationController();

router.get('/suggestions', authenticate, locationController.suggestions);
router.post('/', authenticate, locationController.log);

export default router;
