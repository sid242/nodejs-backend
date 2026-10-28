import { Router } from 'express';

import { requireAuth } from '@/middleware/auth.js';
import { validate } from '@/middleware/validate.js';
import * as controller from '@/modules/users/users.controller.js';
import { updateMeDto } from '@/modules/users/users.dto.js';

const router = Router();
router.use(requireAuth);

router.get('/me', controller.getMe);
router.patch('/me', validate({ body: updateMeDto }), controller.updateMe);

export default router;
