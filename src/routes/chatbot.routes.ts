import { Router } from 'express';
import { ChatbotController } from '../controllers/chatbot.controller';
import { authenticate } from '../middleware/auth.middleware';
import { authorize } from '../middleware/rbac.middleware';

const router = Router();
const controller = new ChatbotController();

router.use(authenticate);
router.use(authorize(['owner', 'admin']));

router.get('/suggestions', controller.getSuggestions.bind(controller));
router.post('/query', controller.query.bind(controller));
router.post('/export', controller.exportCsv.bind(controller));

export default router;
