import { Router } from 'express';

import { requireAuth } from '@/middleware/auth';
import { validate } from '@/middleware/validate';
import * as controller from '@/modules/users/users.controller';
import { updateMeDto } from '@/modules/users/users.dto';

const router = Router();
router.use(requireAuth);

router.get('/me', controller.getMe);
router.patch('/me', validate({ body: updateMeDto }), controller.updateMe);

export default router;
