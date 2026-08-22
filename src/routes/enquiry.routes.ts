import { Router } from 'express';
import { EnquiryController } from '../controllers/enquiry.controller';
import { authenticate } from '../middleware/auth.middleware';
import { authorize } from '../middleware/rbac.middleware';

const router = Router();
const enquiryController = new EnquiryController();

router.get('/', authenticate, authorize(['owner', 'manager', 'sales', 'admin']), enquiryController.getAll);
router.post('/', authenticate, authorize(['owner', 'manager', 'sales', 'admin']), enquiryController.create);
router.put('/:id', authenticate, authorize(['owner', 'manager', 'sales', 'admin']), enquiryController.update);

export default router;

