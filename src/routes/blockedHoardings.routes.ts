import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { authorize } from '../middleware/rbac.middleware';
import blockedHoardingsController from '../controllers/blockedHoardings.controller';

const router = Router();

router.get(
  '/by-client',
  authenticate,
  authorize(['owner', 'manager', 'sales', 'supervisor', 'admin']),
  blockedHoardingsController.byClient,
);

export default router;
