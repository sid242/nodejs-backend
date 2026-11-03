import { Router } from 'express';

import { requireAuth } from '@/middleware/auth';
import { geoLimiter } from '@/middleware/rate-limit';
import { validate } from '@/middleware/validate';
import * as controller from './geo.controller';
import { getChildrenQueryDto, lookupQueryDto, pinParamDto } from './geo.dto';

const router = Router();

router.use(requireAuth);
router.use(geoLimiter);

router.get('/states', controller.getStates);
router.get('/children', validate({ query: getChildrenQueryDto }), controller.getChildren);
router.get('/pincode/:pin', validate({ params: pinParamDto }), controller.getPin);
router.get('/lookup', validate({ query: lookupQueryDto }), controller.lookup);

export default router;

