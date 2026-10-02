import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/async-handler.js';
import { validate } from '../../middleware/validate.js';
import { authLimiter } from '../../middleware/rate-limit.js';
import { requireAuth } from '../../middleware/auth.js';
import { revokeRefreshToken } from './tokens.js';
import { AppResponse } from '../../lib/responses.js';
import * as service from './auth.service.js';

const router = Router();
router.use(authLimiter);

const credentials = {
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
};
const tokenBody = z.object({ refreshToken: z.string().min(1) });

router.post(
  '/register',
  validate({ body: z.object({ ...credentials, name: z.string().min(1).max(100) }) }),
  asyncHandler(async (req, res) =>
    AppResponse.created(await service.register(req.valid.body), 'Registered').send(res),
  ),
);

router.post(
  '/login',
  validate({ body: z.object(credentials) }),
  asyncHandler(async (req, res) =>
    AppResponse.ok(await service.login(req.valid.body), 'Logged in').send(res),
  ),
);

router.post(
  '/refresh',
  validate({ body: tokenBody }),
  asyncHandler(async (req, res) =>
    AppResponse.ok(await service.refresh(req.valid.body.refreshToken), 'Token refreshed').send(res),
  ),
);

router.post(
  '/logout',
  validate({ body: tokenBody }),
  asyncHandler(async (req, res) => {
    await revokeRefreshToken(req.valid.body.refreshToken);
    res.status(204).end();
  }),
);

router.post(
  '/forgot-password',
  validate({ body: z.object({ email: z.string().email().max(254) }) }),
  asyncHandler(async (req, res) =>
    AppResponse.ok(await service.forgotPassword(req.valid.body)).send(res),
  ),
);

router.post(
  '/reset-password',
  validate({
    body: z.object({
      token: z.string().min(1),
      password: z.string().min(8).max(128),
    }),
  }),
  asyncHandler(async (req, res) =>
    AppResponse.ok(await service.resetPassword(req.valid.body)).send(res),
  ),
);

router.post(
  '/verify-email/request',
  requireAuth,
  asyncHandler(async (req, res) =>
    AppResponse.ok(await service.requestEmailVerification(req.user.id)).send(res),
  ),
);

router.post(
  '/verify-email/confirm',
  validate({ body: z.object({ token: z.string().min(1) }) }),
  asyncHandler(async (req, res) =>
    AppResponse.ok(await service.verifyEmail(req.valid.body)).send(res),
  ),
);

export default router;
