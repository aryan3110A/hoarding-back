import { Router } from 'express';
import { PropertyRentController } from '../controllers/propertyRent.controller';
import { authenticate } from '../middleware/auth.middleware';
import { authorize } from '../middleware/rbac.middleware';
import { validate } from '../middleware/validation.middleware';
import { savePropertyRentSchema } from '../validators/propertyRent.validators';
import { rentPaymentUpload } from '../middleware/upload.middleware';

const router = Router();
const controller = new PropertyRentController();

router.use(authenticate);

// Owner/Admin only for due board + payments (PDF requirement)
router.get('/property-rents/summary', authorize(['owner', 'admin']), controller.summary);
router.get('/property-rents/due-board', authorize(['owner', 'admin']), controller.dueBoard);
router.get(
  '/property-rents/payment-totals',
  authorize(['owner', 'admin']),
  controller.paymentTotals,
);
router.post(
  '/property-rents/pay',
  authorize(['owner', 'admin']),
  rentPaymentUpload.single('screenshot'),
  controller.recordPayment,
);

router.get('/property-rents', authorize(['owner', 'manager', 'admin']), controller.list);
router.get(
  '/property-rents/by-landlord/:landlordName',
  authorize(['owner', 'manager', 'admin']),
  controller.getByLandlord,
);
router.get(
  '/property-rents/:propertyGroupId',
  authorize(['owner', 'manager', 'admin']),
  controller.get,
);
router.post(
  '/property-rents',
  authorize(['owner', 'manager', 'admin']),
  validate(savePropertyRentSchema),
  controller.save,
);

export default router;
