import { Router } from 'express';
import { ContractController } from '../controllers/contract.controller';
import { authenticate } from '../middleware/auth.middleware';
import { authorize } from '../middleware/rbac.middleware';

const router = Router();
const contractController = new ContractController();

router.get(
  '/renewals-due',
  authenticate,
  authorize(['owner', 'manager', 'sales', 'accountant', 'admin']),
  contractController.getRenewalsDue,
);

router.get(
  '/',
  authenticate,
  authorize(['owner', 'manager', 'accountant', 'admin']),
  contractController.getAll,
);
router.get(
  '/:id',
  authenticate,
  authorize(['owner', 'manager', 'admin', 'sales', 'accountant']),
  contractController.getById,
);
router.post(
  '/',
  authenticate,
  authorize(['owner', 'manager', 'admin', 'sales']),
  contractController.create,
);
router.post(
  '/:id/send-renewal-reminder',
  authenticate,
  authorize(['owner', 'manager', 'sales', 'admin']),
  contractController.sendRenewalReminder,
);

router.post(
  '/:id/renew',
  authenticate,
  authorize(['owner', 'manager', 'admin', 'sales']),
  contractController.renew,
);
router.post(
  '/:id/cancel',
  authenticate,
  authorize(['owner', 'manager', 'admin']),
  contractController.cancel,
);

export default router;
