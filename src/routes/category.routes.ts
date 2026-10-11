import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { authorize } from '../middleware/rbac.middleware';
import categoryController from '../controllers/category.controller';

const router = Router();

router.get(
  '/',
  authenticate,
  authorize(['owner', 'manager', 'sales', 'admin']),
  categoryController.list,
);
router.post(
  '/',
  authenticate,
  authorize(['owner', 'manager', 'admin', 'sales']),
  categoryController.create,
);

export default router;
