import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/async-handler.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { uploadLimiter } from '../../middleware/rate-limit.js';
import { AppResponse } from '../../lib/responses.js';
import * as service from './files.service.js';

const router = Router();
router.use(requireAuth);

const idParams = z.object({ id: z.string().uuid() });

router.get(
  '/',
  asyncHandler(async (req, res) => AppResponse.ok(await service.listFiles(req.user.id)).send(res)),
);

router.post(
  '/upload-url',
  uploadLimiter,
  validate({
    body: z.object({
      filename: z.string().min(1).max(200),
      contentType: z.enum(service.ALLOWED_TYPES),
    }),
  }),
  asyncHandler(async (req, res) =>
    AppResponse.created(
      await service.requestUpload(req.user.id, req.valid.body),
      'Upload requested',
    ).send(res),
  ),
);

router.post(
  '/:id/confirm',
  validate({ params: idParams }),
  asyncHandler(async (req, res) =>
    AppResponse.ok(
      await service.confirmUpload(req.user.id, req.valid.params.id),
      'Upload confirmed',
    ).send(res),
  ),
);

router.get(
  '/:id/download-url',
  validate({ params: idParams }),
  asyncHandler(async (req, res) =>
    AppResponse.ok(await service.getDownloadUrl(req.user.id, req.valid.params.id)).send(res),
  ),
);

router.delete(
  '/:id',
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    await service.deleteFile(req.user.id, req.valid.params.id);
    res.status(204).end();
  }),
);

export default router;
