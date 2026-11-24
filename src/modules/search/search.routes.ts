import { Router } from 'express';

import { requireAuth } from '@/middleware/auth';
import { searchLimiter } from '@/middleware/rate-limit';
import { resolveTenantContext } from '@/middleware/tenant';
import { validate } from '@/middleware/validate';

import * as controller from './search.controller';
import { searchQueryDto } from './search.dto';

const router = Router();

router.use(requireAuth);
router.use(resolveTenantContext);
router.use(searchLimiter);

router.get('/', validate({ query: searchQueryDto }), controller.handleGlobalSearch);

export default router;
