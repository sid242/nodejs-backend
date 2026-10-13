import bcrypt from 'bcryptjs';
import * as authRepo from '@/modules/auth/auth.repository.js';
import { AppError } from '@/lib/errors.js';
import { cache } from '@/lib/cache.js';
import { emailQueue } from '@/queues/index.js';
import {
  issueTokens,
  consumeRefreshToken,
  createPasswordResetToken,
  verifyAndConsumePasswordResetToken,
  createEmailVerificationToken,
  verifyAndConsumeEmailVerificationToken,
  revokeAllUserTokens,
  type AuthTokens,
} from '@/modules/auth/tokens.js';
import type {
  RegisterDto,
  LoginDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from '@/modules/auth/auth.dto.js';
import type { PublicUser } from '@/db/schema/index.js';
import { AUTH_MESSAGES, REDIS_PREFIXES } from '@/constants/index.js';

// Compared against when the user doesn't exist, so response time doesn't reveal valid emails.
const DUMMY_HASH = bcrypt.hashSync('dummy-password', 12);

export interface AuthResult extends AuthTokens {
  user: PublicUser;
}

export async function register({ email, password, name }: RegisterDto): Promise<AuthResult> {
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await authRepo.createUser({ email, passwordHash, name });
  await cache.delByPrefix(REDIS_PREFIXES.USERS_LIST_CACHE);

  // Slow/unreliable work goes to the queue, not the request path. jobId makes it idempotent.
  const verificationToken = await createEmailVerificationToken(user.id);
  await Promise.all([
    emailQueue.add('welcome', { to: user.email, name: user.name }, { jobId: `welcome-${user.id}` }),
    emailQueue.add(
      'verify-email',
      { to: user.email, name: user.name, token: verificationToken },
      { jobId: `verify-email-${user.id}-${Date.now()}` },
    ),
  ]);

  return { user, ...(await issueTokens(user)) };
}

export async function login({ email, password }: LoginDto): Promise<AuthResult> {
  const record = await authRepo.findByEmail(email);
  const ok = await bcrypt.compare(password, record?.passwordHash ?? DUMMY_HASH);
  if (!record || !ok || record.deletedAt)
    throw AppError.unauthorized(AUTH_MESSAGES.INVALID_CREDENTIALS);

  if (record.status === 'SUSPENDED' || record.status === 'DEACTIVATED') {
    throw AppError.forbidden(`Account is ${record.status.toLowerCase()}`);
  }

  if (!record.emailVerifiedAt) {
    throw AppError.forbidden(AUTH_MESSAGES.EMAIL_NOT_VERIFIED, {
      email: record.email,
      emailVerified: false,
    });
  }

  const user: PublicUser = {
    id: record.id,
    email: record.email,
    name: record.name,
    role: record.role,
    status: record.status,
    emailVerifiedAt: record.emailVerifiedAt,
    phoneNumber: record.phoneNumber,
    phoneVerifiedAt: record.phoneVerifiedAt,
    createdAt: record.createdAt,
  };
  return { user, ...(await issueTokens(user)) };
}

export async function refresh(refreshToken: string): Promise<AuthTokens> {
  const userId = await consumeRefreshToken(refreshToken);
  const user = await authRepo.findPublicUserById(userId);
  if (!user) throw AppError.unauthorized();
  if (!user.emailVerifiedAt) {
    throw AppError.forbidden(AUTH_MESSAGES.EMAIL_NOT_VERIFIED, {
      email: user.email,
      emailVerified: false,
    });
  }

  return issueTokens(user);
}

export async function forgotPassword({ email }: ForgotPasswordDto): Promise<{ message: string }> {
  const record = await authRepo.findByEmail(email);

  if (record) {
    const token = await createPasswordResetToken(record.id);
    await emailQueue.add(
      'password-reset',
      { to: record.email, name: record.name, token },
      { jobId: `pwd-reset-${record.id}-${Date.now()}` },
    );
  }

  return { message: AUTH_MESSAGES.PASSWORD_RESET_SENT };
}

export async function resetPassword({
  token,
  password,
}: ResetPasswordDto): Promise<{ message: string }> {
  const userId = await verifyAndConsumePasswordResetToken(token);
  const passwordHash = await bcrypt.hash(password, 12);

  const user = await authRepo.updatePassword(userId, passwordHash);
  if (!user) throw AppError.notFound('User not found');

  await Promise.all([
    revokeAllUserTokens(userId),
    cache.del(`${REDIS_PREFIXES.USER_CACHE}${userId}`),
  ]);

  return { message: AUTH_MESSAGES.PASSWORD_RESET_SUCCESS };
}

export async function requestEmailVerification(identifier: {
  userId?: string;
  email?: string;
}): Promise<{ message: string }> {
  let user: any = null;
  if (identifier.userId) {
    user = await authRepo.findById(identifier.userId);
  } else if (identifier.email) {
    user = await authRepo.findByEmail(identifier.email);
  }

  // Prevent email enumeration: return generic message if user not found
  if (!user) {
    return { message: AUTH_MESSAGES.VERIFICATION_EMAIL_SENT };
  }

  if (user.emailVerifiedAt) {
    if (identifier.userId) {
      throw AppError.badRequest(AUTH_MESSAGES.EMAIL_ALREADY_VERIFIED);
    }
    return { message: AUTH_MESSAGES.VERIFICATION_EMAIL_SENT };
  }

  const token = await createEmailVerificationToken(user.id);
  await emailQueue.add(
    'verify-email',
    { to: user.email, name: user.name, token },
    { jobId: `verify-email-${user.id}-${Date.now()}` },
  );

  return { message: AUTH_MESSAGES.VERIFICATION_EMAIL_SENT };
}

export async function verifyEmail({
  token,
}: VerifyEmailDto): Promise<{ user: PublicUser; message: string }> {
  const userId = await verifyAndConsumeEmailVerificationToken(token);
  const user = await authRepo.markEmailVerified(userId);

  if (!user) throw AppError.notFound('User not found');
  await cache.del(`${REDIS_PREFIXES.USER_CACHE}${userId}`);

  return { user, message: AUTH_MESSAGES.EMAIL_VERIFIED_SUCCESS };
}
