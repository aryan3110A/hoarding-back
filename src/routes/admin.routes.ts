import { Router } from 'express';
import adminController from '../controllers/admin.controller';
import { authenticate } from '../middleware/auth.middleware';
import { authorize } from '../middleware/rbac.middleware';

const router = Router();

// POST /api/admin/contract-expiry
router.post(
  '/contract-expiry',
  authenticate,
  authorize(['owner', 'admin', 'manager']),
  (req, res, next) => adminController.runContractExpiry(req, res, next),
);

export default router;
