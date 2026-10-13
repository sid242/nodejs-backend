import { Router } from 'express';
import { validate } from '@/middleware/validate.js';
import { requireAuth, requireRole } from '@/middleware/auth.js';
import {
  updateMeDto,
  listUsersQueryDto,
  updateUserRoleDto,
  updateUserStatusDto,
} from '@/modules/users/users.dto.js';
import * as controller from '@/modules/users/users.controller.js';

const router = Router();
router.use(requireAuth);

router.get('/me', controller.getMe);
router.patch('/me', validate({ body: updateMeDto }), controller.updateMe);

// --- System Admin Endpoints ---
router.get('/', requireRole('ADMIN'), validate({ query: listUsersQueryDto }), controller.listUsers);
router.get('/:userId', requireRole('ADMIN'), controller.getUser);
router.patch(
  '/:userId/role',
  requireRole('ADMIN'),
  validate({ body: updateUserRoleDto }),
  controller.updateUserRole,
);
router.patch(
  '/:userId/status',
  requireRole('ADMIN'),
  validate({ body: updateUserStatusDto }),
  controller.updateUserStatus,
);

export default router;
