import { Router } from 'express';
import { UserController } from '../controllers/user.controller';
import { authenticate } from '../middleware/auth.middleware';
import { authorize } from '../middleware/rbac.middleware';

const router = Router();
const userController = new UserController();

// User CRUD routes - Owner/Admin only
router.get('/', authenticate, authorize(['owner', 'admin']), userController.getAllUsers);
router.get(
  '/sales/device-status',
  authenticate,
  authorize(['owner', 'admin']),
  userController.getSalesUserDeviceStatus,
);
router.get(
  '/sales/device-status/debug',
  authenticate,
  authorize(['owner', 'admin']),
  userController.getSalesUserDeviceStatusDebug,
);
router.get('/:id', authenticate, authorize(['owner', 'admin']), userController.getUserById);
router.post('/', authenticate, authorize(['owner', 'admin']), userController.createUser);
router.put('/:id', authenticate, authorize(['owner', 'admin']), userController.updateUser);
router.delete('/:id', authenticate, authorize(['owner', 'admin']), userController.deleteUser);

// Device management routes - Admin only
router.get(
  '/:userId/devices',
  authenticate,
  authorize(['admin', 'owner']),
  userController.getUserDevices,
);
router.delete(
  '/:userId/devices/:deviceId',
  authenticate,
  authorize(['admin', 'owner']),
  userController.revokeDevice,
);

export default router;
