import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { authorize } from '../middleware/rbac.middleware';
import recycleBinController from '../controllers/recycleBin.controller';

const router = Router();

router.get(
  '/',
  authenticate,
  authorize(['owner', 'admin']),
  recycleBinController.list,
);

router.post(
  '/:id/restore',
  authenticate,
  authorize(['owner', 'admin']),
  recycleBinController.restore,
);

router.delete(
  '/:id',
  authenticate,
  authorize(['owner', 'admin']),
  recycleBinController.purge,
);

export default router;
