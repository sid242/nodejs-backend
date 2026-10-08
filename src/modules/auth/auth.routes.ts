import { Router } from 'express';
import { validate } from '@/middleware/validate.js';
import { authLimiter } from '@/middleware/rate-limit.js';
import { requireAuth } from '@/middleware/auth.js';
import {
  registerDto,
  loginDto,
  refreshTokenDto,
  forgotPasswordDto,
  resetPasswordDto,
  verifyEmailDto,
} from '@/modules/auth/auth.dto.js';
import * as controller from '@/modules/auth/auth.controller.js';

const router = Router();
router.use(authLimiter);

router.post('/register', validate({ body: registerDto }), controller.register);
router.post('/login', validate({ body: loginDto }), controller.login);
router.post('/refresh', validate({ body: refreshTokenDto }), controller.refresh);
router.post('/logout', validate({ body: refreshTokenDto }), controller.logout);
router.post('/forgot-password', validate({ body: forgotPasswordDto }), controller.forgotPassword);
router.post('/reset-password', validate({ body: resetPasswordDto }), controller.resetPassword);
router.post('/verify-email/request', requireAuth, controller.requestEmailVerification);
router.post('/verify-email/confirm', validate({ body: verifyEmailDto }), controller.verifyEmail);

export default router;
