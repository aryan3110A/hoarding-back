import { Router } from 'express';
import inquiryController from '../controllers/inquiry.controller';
import { authenticate } from '../middleware/auth.middleware';
import { authorize } from '../middleware/rbac.middleware';
import { validate } from '../middleware/validation.middleware';
import { createInquirySchema, updateInquirySchema } from '../validators/inquiry.validators';

const router = Router();

router.get(
  '/sales-users',
  authenticate,
  authorize(['owner', 'manager', 'admin', 'sales_head', 'sales head']),
  inquiryController.listSalesUsers,
);

// Both Owner and Sales can create/list. Manager/Admin allowed as well.
router.get(
  '/',
  authenticate,
  authorize(['owner', 'manager', 'sales', 'accountant', 'admin']),
  inquiryController.getAll,
);
router.get(
  '/reminders',
  authenticate,
  authorize(['owner', 'manager', 'sales', 'admin']),
  inquiryController.getReminders,
);
router.get(
  '/:id',
  authenticate,
  authorize(['owner', 'manager', 'sales', 'accountant', 'admin']),
  inquiryController.getById,
);
router.post(
  '/',
  authenticate,
  authorize(['owner', 'manager', 'sales', 'admin']),
  validate(createInquirySchema),
  inquiryController.create,
);
router.put(
  '/:id',
  authenticate,
  authorize(['owner', 'manager', 'sales', 'admin']),
  validate(updateInquirySchema),
  inquiryController.update,
);

router.put(
  '/:id/assign-sales',
  authenticate,
  authorize(['owner', 'manager', 'admin']),
  inquiryController.assignSales,
);

export default router;
