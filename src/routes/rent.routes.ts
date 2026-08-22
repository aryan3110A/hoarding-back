import { Router } from 'express';
import { RentController } from '../controllers/rent.controller';
import { authenticate } from '../middleware/auth.middleware';
import { authorize } from '../middleware/rbac.middleware';
import { validate } from '../middleware/validation.middleware';
import { saveRentSchema } from '../validators/rent.validators';

const router = Router();
const rentController = new RentController();

// All rent routes require authentication
router.use(authenticate);

// Get all rent records (Owner/Manager only) - separate route to avoid conflict
router.get(
    '/rents/all',
    authorize(['owner', 'manager', 'admin']),
    rentController.getAllRents
);

// Get rent details for a hoarding
router.get('/:id/rent', rentController.getRentDetails);

// Save rent details (Owner/Manager only)
router.post(
    '/:id/rent',
    authorize(['admin', 'owner', 'manager']), // Assuming 'admin' exists, spec says Owner/Manager
    validate(saveRentSchema),
    rentController.saveRent
);

// Recalculate rent (Owner/Manager only)
router.post(
    '/:id/rent/recalculate',
    authorize(['admin', 'owner', 'manager']),
    rentController.recalculateRent
);

export default router;
