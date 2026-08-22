import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { authorize } from '../middleware/rbac.middleware';
import { validate } from '../middleware/validation.middleware';
import landlordController from '../controllers/landlord.controller';
import { createLandlordSchema } from '../validators/landlord.validators';

const router = Router();

router.get(
  '/hoardings',
  authenticate,
  authorize(['owner', 'manager', 'admin']),
  landlordController.groupedHoardings,
);

router.get(
  '/',
  authenticate,
  authorize(['owner', 'manager', 'admin', 'sales', 'designer', 'fitter', 'supervisor', 'accountant']),
  landlordController.list,
);

router.post(
  '/',
  authenticate,
  authorize(['owner', 'manager', 'admin']),
  validate(createLandlordSchema),
  landlordController.create,
);

export default router;
