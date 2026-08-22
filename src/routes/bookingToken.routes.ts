import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { authorize } from '../middleware/rbac.middleware';
import { installationProofUpload } from '../middleware/upload.middleware';
import { BlockHoardingController } from '../controllers/bookingToken.controller';

const router = Router();
const controller = new BlockHoardingController();

// Sales can create blocks; admins can confirm; sales can cancel own
router.post(
  '/',
  authenticate,
  authorize(['sales', 'owner', 'manager', 'admin']),
  controller.create,
);
router.get('/recent', authenticate, authorize(['owner', 'manager', 'admin']), controller.recent);

// NOTE: keep fixed routes above '/:id' to avoid shadowing
router.get(
  '/mine',
  authenticate,
  authorize(['sales', 'owner', 'manager', 'admin']),
  controller.mine,
);

router.get('/assigned', authenticate, authorize(['designer']), controller.assignedToMe);
router.get(
  '/assigned-installations',
  authenticate,
  authorize(['fitter']),
  controller.assignedInstallations,
);
router.get(
  '/fitters',
  authenticate,
  authorize(['owner', 'manager', 'admin', 'supervisor']),
  controller.fitters,
);
router.get(
  '/designers',
  authenticate,
  authorize(['sales', 'owner', 'manager', 'admin']),
  controller.designers,
);

router.get(
  '/:id',
  authenticate,
  authorize(['sales', 'owner', 'manager', 'admin', 'designer', 'supervisor', 'fitter']),
  controller.getById,
);
router.post(
  '/:id/confirm',
  authenticate,
  authorize(['owner', 'manager', 'admin', 'sales']),
  controller.confirm,
);

// Designer can update design status for an assigned token
router.put(
  '/:id/design-status',
  authenticate,
  authorize(['designer']),
  controller.updateDesignStatus,
);

router.put(
  '/:id/assign-fitter',
  authenticate,
  authorize(['owner', 'manager', 'admin', 'supervisor']),
  controller.assignFitter,
);

router.put(
  '/:id/fitter-status',
  authenticate,
  authorize(['fitter']),
  controller.updateFitterStatus,
);

router.post(
  '/:id/complete-installation',
  authenticate,
  authorize(['fitter']),
  installationProofUpload.array('images', 10),
  controller.completeInstallation,
);

// Sales requests extension for an active blocked token
router.post(
  '/:id/request-extension',
  authenticate,
  authorize(['sales']),
  controller.requestExtension,
);

// Owner/Manager/Admin approves or rejects extension
router.post(
  '/:id/approve-extension',
  authenticate,
  authorize(['owner', 'manager', 'admin']),
  controller.approveExtension,
);
router.post(
  '/:id/reject-extension',
  authenticate,
  authorize(['owner', 'manager', 'admin']),
  controller.rejectExtension,
);

router.post(
  '/:id/cancel',
  authenticate,
  authorize(['sales', 'owner', 'manager', 'admin']),
  controller.cancel,
);

// Explicit release/unblock alias (same behavior as cancel)
router.post(
  '/:id/release',
  authenticate,
  authorize(['sales', 'owner', 'manager', 'admin']),
  controller.release,
);

export default router;
