import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/async-handler.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { AppResponse } from '../../lib/responses.js';
import * as service from './users.service.js';

const router = Router();
router.use(requireAuth);

router.get(
  '/me',
  asyncHandler(async (req, res) => AppResponse.ok(await service.getMe(req.user.id)).send(res)),
);

router.patch(
  '/me',
  validate({ body: z.object({ name: z.string().min(1).max(100) }) }),
  asyncHandler(async (req, res) =>
    AppResponse.ok(await service.updateMe(req.user.id, req.valid.body), 'Profile updated').send(
      res,
    ),
  ),
);

router.get(
  '/',
  requireRole('ADMIN'),
  validate({
    query: z.object({
      // Offset scans become increasingly expensive; cap the legacy page API.
      page: z.coerce.number().int().min(1).max(10_000).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    }),
  }),
  asyncHandler(async (req, res) =>
    AppResponse.ok(await service.listUsers(req.valid.query)).send(res),
  ),
);

export default router;
