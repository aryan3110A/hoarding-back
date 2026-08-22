import { Router } from 'express';
import { HoardingController } from '../controllers/hoarding.controller';
import { authenticate } from '../middleware/auth.middleware';
import { authorize } from '../middleware/rbac.middleware';
import { validate } from '../middleware/validation.middleware';
import { createHoardingSchema, updateHoardingSchema } from '../validators/hoarding.validators';

const router = Router();
const hoardingController = new HoardingController();

router.get('/', authenticate, hoardingController.getAll);
router.get('/cities', authenticate, hoardingController.listCities);
router.get('/landmarks', authenticate, hoardingController.listLandmarks);
router.get('/types', authenticate, hoardingController.listTypes);
router.get(
  '/next-code',
  authenticate,
  authorize(['owner', 'manager', 'admin']),
  hoardingController.nextCode,
);
router.get(
  '/remount-renew/list',
  authenticate,
  authorize(['owner', 'manager', 'sales', 'supervisor', 'accountant', 'admin']),
  hoardingController.listRemountRenew,
);

router.post(
  '/:id/remount-request',
  authenticate,
  authorize(['owner', 'manager', 'sales', 'admin']),
  hoardingController.requestRemount,
);

router.post(
  '/:id/notify-supervisor',
  authenticate,
  authorize(['owner', 'manager', 'sales', 'accountant', 'admin']),
  hoardingController.notifySupervisor,
);

router.post(
  '/:id/remount-complete',
  authenticate,
  authorize(['supervisor', 'owner', 'manager', 'admin']),
  hoardingController.completeRemount,
);

router.post(
  '/:id/renew',
  authenticate,
  authorize(['owner', 'manager', 'sales', 'admin']),
  hoardingController.renew,
);

router.get(
  '/:id/renewal-history',
  authenticate,
  authorize(['owner', 'manager', 'sales', 'supervisor', 'accountant', 'admin']),
  hoardingController.renewalHistory,
);

router.get('/:id/availability', authenticate, hoardingController.getAvailability);
router.get('/:id', authenticate, hoardingController.getById);

// CRUD operations - Owner and Manager can create, update, delete
// Sales can only view (filtered by territory)
router.post(
  '/',
  authenticate,
  authorize(['owner', 'manager', 'admin']),
  validate(createHoardingSchema),
  hoardingController.create,
);

// Add image metadata (filenames) for a hoarding
router.post(
  '/:id/images',
  authenticate,
  authorize(['owner', 'manager', 'admin']),
  hoardingController.addImages,
);

// Manager marks hoarding Under Process after token payment received
router.post(
  '/:id/under-process',
  authenticate,
  authorize(['owner', 'manager', 'admin']),
  hoardingController.markUnderProcess,
);

// Finalize operational workflow after fitting
router.post(
  '/:id/finalize-status',
  authenticate,
  authorize(['owner', 'manager', 'sales']),
  hoardingController.finalizeStatus,
);

router.put(
  '/:id',
  authenticate,
  authorize(['owner', 'manager', 'admin']),
  validate(updateHoardingSchema),
  hoardingController.update,
);

router.delete(
  '/:id',
  authenticate,
  authorize(['owner', 'manager', 'admin']),
  hoardingController.delete,
);

export default router;
