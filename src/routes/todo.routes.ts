import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import todoController from '../controllers/todo.controller';

const router = Router();

router.get('/', authenticate, todoController.list);
router.post('/', authenticate, todoController.create);
router.patch('/:id', authenticate, todoController.update);
router.delete('/:id', authenticate, todoController.delete);

export default router;
