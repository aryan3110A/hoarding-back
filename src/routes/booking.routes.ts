import { Router } from 'express';
import { BookingController } from '../controllers/booking.controller';
import { authenticate } from '../middleware/auth.middleware';
import { authorize } from '../middleware/rbac.middleware';

const router = Router();
const bookingController = new BookingController();

router.use(authenticate);

router.get(
  '/',
  authorize(['owner', 'manager', 'sales', 'accountant', 'admin']),
  bookingController.getAll,
);

router.post('/', authorize(['owner', 'manager', 'sales', 'admin']), bookingController.create);

export default router;
