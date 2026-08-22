import { Router } from 'express';
import { RoleController } from '../controllers/role.controller';
import { authenticate } from '../middleware/auth.middleware';
import { authorize } from '../middleware/rbac.middleware';

const router = Router();
const roleController = new RoleController();

// Role CRUD routes - Owner/Admin only
router.get('/', authenticate, authorize(['owner', 'admin']), roleController.getAllRoles);
router.get('/:id', authenticate, authorize(['owner', 'admin']), roleController.getRoleById);
router.post('/', authenticate, authorize(['owner', 'admin']), roleController.createRole);
router.put('/:id', authenticate, authorize(['owner', 'admin']), roleController.updateRole);
router.delete('/:id', authenticate, authorize(['owner', 'admin']), roleController.deleteRole);

export default router;

