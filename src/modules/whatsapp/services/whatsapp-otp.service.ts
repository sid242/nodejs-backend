import crypto from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';

import { env } from '@/config/env';
import { redis } from '@/config/redis';
import { whatsAppOtpChallenges, type WhatsAppOtpPurpose } from '@/db/schema';
import { primaryDbHandle } from '@/db/tenancy/context';
import { AppError } from '@/lib/errors';

import { normalizePhoneNumber } from '../utils/phone-number.util';

const OTP_EXPIRY_MINUTES = 5;
const MAX_VERIFY_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 60;

function hashOtp(code: string, phoneNumber: string, purpose: string): string {
  const secret = env.WHATSAPP_OTP_SECRET || env.META_APP_SECRET || env.JWT_ACCESS_SECRET;
  return crypto
    .createHmac('sha256', secret)
    .update(`${phoneNumber}:${purpose}:${code}`)
    .digest('hex');
}

export interface SendOtpDto {
  phoneNumber: string;
  purpose: WhatsAppOtpPurpose;
}

export interface VerifyOtpDto {
  phoneNumber: string;
  purpose: WhatsAppOtpPurpose;
  code: string;
}

export async function sendOtp(
  dto: SendOtpDto,
  _clientIp?: string,
): Promise<{
  success: boolean;
  message: string;
  expiresInSeconds: number;
}> {
  if (!env.ENABLE_WHATSAPP_AUTH_OTP) {
    throw new AppError(
      503,
      'WhatsApp OTP authentication is currently disabled.',
      'WHATSAPP_OTP_DISABLED',
    );
  }

  const normalizedPhone = normalizePhoneNumber(dto.phoneNumber);

  // 1. Enforce per-phone and per-IP cooldown rate limit
  const cooldownKey = `whatsapp:otp:cooldown:${normalizedPhone}:${dto.purpose}`;
  const inCooldown = await redis.get(cooldownKey);
  if (inCooldown) {
    throw AppError.tooManyRequests(
      `Please wait ${RESEND_COOLDOWN_SECONDS} seconds before requesting another verification code.`,
      { code: 'WHATSAPP_OTP_RATE_LIMITED' },
    );
  }

  // Hourly rate limit per phone number (max 10 OTPs / hour)
  const hourlyKey = `whatsapp:otp:hourly:${normalizedPhone}`;
  const currentCount = await redis.incr(hourlyKey);
  if (currentCount === 1) {
    await redis.expire(hourlyKey, 3600);
  }
  if (currentCount > 10) {
    throw AppError.tooManyRequests(
      'Too many OTP verification requests for this phone number today.',
      { code: 'WHATSAPP_OTP_HOURLY_LIMIT' },
    );
  }

  // 2. Generate secure 6-digit numeric OTP
  const rawCode = crypto.randomInt(100000, 1000000).toString();
  const codeHash = hashOtp(rawCode, normalizedPhone, dto.purpose);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  // 3. Invalidate any previous unconsumed challenge for this phone & purpose
  await primaryDbHandle()
    .update(whatsAppOtpChallenges)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(whatsAppOtpChallenges.phoneNumber, normalizedPhone),
        eq(whatsAppOtpChallenges.purpose, dto.purpose),
        isNull(whatsAppOtpChallenges.consumedAt),
      ),
    );

  // 4. Save new hashed challenge in primary database
  await primaryDbHandle().insert(whatsAppOtpChallenges).values({
    phoneNumber: normalizedPhone,
    purpose: dto.purpose,
    codeHash,
    expiresAt,
    attemptCount: 0,
    maxAttempts: MAX_VERIFY_ATTEMPTS,
  });

  // 5. Set resend cooldown in Redis
  await redis.set(cooldownKey, '1', 'EX', RESEND_COOLDOWN_SECONDS);

  // 6. In a production deployment with configured Meta AUTHENTICATION template, dispatch template message
  // Note: Never log the rawCode or store it plaintext.

  return {
    success: true,
    message: 'Verification code sent to WhatsApp',
    expiresInSeconds: OTP_EXPIRY_MINUTES * 60,
  };
}

export async function verifyOtp(dto: VerifyOtpDto): Promise<{
  verified: boolean;
  message: string;
}> {
  if (!env.ENABLE_WHATSAPP_AUTH_OTP) {
    throw new AppError(
      503,
      'WhatsApp OTP authentication is currently disabled.',
      'WHATSAPP_OTP_DISABLED',
    );
  }

  const normalizedPhone = normalizePhoneNumber(dto.phoneNumber);
  const inputHash = hashOtp(dto.code.trim(), normalizedPhone, dto.purpose);

  // 1. Find active unconsumed challenge
  const [challenge] = await primaryDbHandle()
    .select()
    .from(whatsAppOtpChallenges)
    .where(
      and(
        eq(whatsAppOtpChallenges.phoneNumber, normalizedPhone),
        eq(whatsAppOtpChallenges.purpose, dto.purpose),
        isNull(whatsAppOtpChallenges.consumedAt),
      ),
    )
    .orderBy(desc(whatsAppOtpChallenges.createdAt))
    .limit(1);

  if (!challenge) {
    throw AppError.badRequest('No active verification challenge found or code already used', {
      code: 'WHATSAPP_OTP_NOT_FOUND',
    });
  }

  // 2. Check Expiry
  if (new Date() > challenge.expiresAt) {
    throw AppError.badRequest('Verification code has expired. Please request a new one.', {
      code: 'WHATSAPP_OTP_EXPIRED',
    });
  }

  // 3. Check Attempts
  if (challenge.attemptCount >= challenge.maxAttempts) {
    await primaryDbHandle()
      .update(whatsAppOtpChallenges)
      .set({ consumedAt: new Date() })
      .where(eq(whatsAppOtpChallenges.id, challenge.id));

    throw AppError.badRequest('Too many incorrect attempts. This code is now invalid.', {
      code: 'WHATSAPP_OTP_ATTEMPTS_EXCEEDED',
    });
  }

  // 4. Verify Code Hash
  const isMatch = crypto.timingSafeEqual(
    Buffer.from(challenge.codeHash, 'utf-8'),
    Buffer.from(inputHash, 'utf-8'),
  );

  if (!isMatch) {
    await primaryDbHandle()
      .update(whatsAppOtpChallenges)
      .set({ attemptCount: challenge.attemptCount + 1 })
      .where(eq(whatsAppOtpChallenges.id, challenge.id));

    const remaining = challenge.maxAttempts - (challenge.attemptCount + 1);
    throw AppError.badRequest(`Invalid verification code. ${remaining} attempts remaining.`, {
      code: 'WHATSAPP_OTP_INVALID',
      remainingAttempts: remaining,
    });
  }

  // 5. Consume Challenge
  await primaryDbHandle()
    .update(whatsAppOtpChallenges)
    .set({ consumedAt: new Date() })
    .where(eq(whatsAppOtpChallenges.id, challenge.id));

  return {
    verified: true,
    message: 'Phone number verified successfully',
  };
}
