import { Router } from 'express';
import { validate } from '@/middleware/validate.js';
import { requireAuth, requireRole } from '@/middleware/auth.js';
import { updateMeDto, listUsersQueryDto } from '@/modules/users/users.dto.js';
import * as controller from '@/modules/users/users.controller.js';

const router = Router();
router.use(requireAuth);

router.get('/me', controller.getMe);
router.patch('/me', validate({ body: updateMeDto }), controller.updateMe);
router.get('/', requireRole('ADMIN'), validate({ query: listUsersQueryDto }), controller.listUsers);

export default router;
