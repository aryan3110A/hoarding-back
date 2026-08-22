import { Router } from 'express';
import { MaintenanceController } from '../controllers/maintenance.controller';
import { authenticate } from '../middleware/auth.middleware';
import { authorize } from '../middleware/rbac.middleware';
import { maintenanceUpload } from '../middleware/upload.middleware';

const router = Router();
const controller = new MaintenanceController();

router.use(authenticate);

router.get(
  '/types',
  authorize(['owner', 'admin', 'supervisor', 'manager']),
  controller.types,
);

router.get(
  '/',
  authorize(['owner', 'admin', 'supervisor', 'manager']),
  controller.listRecent,
);

router.get(
  '/hoarding/:hoardingId',
  authorize(['owner', 'admin', 'supervisor', 'manager']),
  controller.listByHoarding,
);

router.post(
  '/',
  authorize(['owner', 'admin', 'supervisor', 'manager']),
  maintenanceUpload.single('photo'),
  controller.create,
);

export default router;
