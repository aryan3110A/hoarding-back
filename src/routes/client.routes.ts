import { Router } from 'express';
import { ClientController } from '../controllers/client.controller';
import { authenticate } from '../middleware/auth.middleware';
import { authorize } from '../middleware/rbac.middleware';

const router = Router();
const clientController = new ClientController();

router.get(
  '/',
  authenticate,
  authorize(['owner', 'manager', 'sales', 'accountant', 'admin']),
  clientController.getAll,
);

router.get(
  '/search',
  authenticate,
  authorize(['owner', 'manager', 'sales', 'accountant', 'admin']),
  clientController.search,
);

router.get(
  '/by-phone',
  authenticate,
  authorize(['owner', 'manager', 'sales', 'accountant', 'admin']),
  clientController.getByPhone,
);

router.get(
  '/:id',
  authenticate,
  authorize(['owner', 'manager', 'sales', 'accountant', 'admin']),
  clientController.getById,
);

router.patch(
  '/:id/billing-profile',
  authenticate,
  authorize(['owner', 'manager', 'accountant', 'admin']),
  clientController.upsertBillingProfile,
);

router.post(
  '/',
  authenticate,
  authorize(['owner', 'manager', 'sales', 'admin']),
  clientController.create,
);

router.get(
  '/:id/history',
  authenticate,
  authorize(['owner', 'manager', 'sales', 'accountant', 'admin']),
  clientController.getHistory,
);

export default router;
