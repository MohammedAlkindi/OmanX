import { Router } from 'express';
import { chatController, healthController, adminPolicyController } from './controllers.js';
import { requireAdmin } from '../middleware/auth.js';

const router = Router();

router.get('/health', healthController);
router.post('/chat', chatController);
router.post('/admin/policy-check', requireAdmin, adminPolicyController);

export default router;
