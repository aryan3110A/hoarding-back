import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { taskAttachmentUpload } from '../middleware/upload.middleware';
import todoController from '../controllers/todo.controller';

const router = Router();

router.get('/', authenticate, todoController.list);
// create / update accept JSON or multipart/form-data (optional photos in the `images` field)
router.post('/', authenticate, taskAttachmentUpload, todoController.create);
router.patch('/:id', authenticate, taskAttachmentUpload, todoController.update);
router.delete('/:id', authenticate, todoController.delete);

export default router;
