import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';
import { validate } from '../middleware/validation.middleware';
import { authenticate } from '../middleware/auth.middleware';
import { loginSchema, refreshTokenSchema, logoutSchema } from '../validators/auth.validators';

const router = Router();
const authController = new AuthController();

router.post('/login', validate(loginSchema), authController.login);
router.post('/refresh', validate(refreshTokenSchema), authController.refresh);
router.post('/logout', validate(logoutSchema), authController.logout);
router.get('/session', authenticate, authController.session);

export default router;
