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

// Compared against when the user doesn't exist, so response time doesn't reveal valid emails.
const DUMMY_HASH = bcrypt.hashSync('dummy-password', 12);

export interface AuthResult extends AuthTokens {
  user: PublicUser;
}

export async function register({ email, password, name }: RegisterDto): Promise<AuthResult> {
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await authRepo.createUser({ email, passwordHash, name });
  await cache.delByPrefix('users:list:');

  // Slow/unreliable work goes to the queue, not the request path. jobId makes it idempotent.
  await emailQueue.add(
    'welcome',
    { to: user.email, name: user.name },
    { jobId: `welcome-${user.id}` },
  );

  return { user, ...(await issueTokens(user)) };
}

export async function login({ email, password }: LoginDto): Promise<AuthResult> {
  const record = await authRepo.findByEmail(email);
  const ok = await bcrypt.compare(password, record?.passwordHash ?? DUMMY_HASH);
  if (!record || !ok) throw AppError.unauthorized('Invalid email or password');

  const user: PublicUser = {
    id: record.id,
    email: record.email,
    name: record.name,
    role: record.role,
    emailVerifiedAt: record.emailVerifiedAt,
    createdAt: record.createdAt,
  };
  return { user, ...(await issueTokens(user)) };
}

export async function refresh(refreshToken: string): Promise<AuthTokens> {
  const userId = await consumeRefreshToken(refreshToken);
  const user = await authRepo.findPublicUserById(userId);
  if (!user) throw AppError.unauthorized();

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

  return { message: 'If that email is registered, password reset instructions have been sent.' };
}

export async function resetPassword({
  token,
  password,
}: ResetPasswordDto): Promise<{ message: string }> {
  const userId = await verifyAndConsumePasswordResetToken(token);
  const passwordHash = await bcrypt.hash(password, 12);

  const user = await authRepo.updatePassword(userId, passwordHash);
  if (!user) throw AppError.notFound('User not found');

  await Promise.all([revokeAllUserTokens(userId), cache.del(`user:${userId}`)]);

  return { message: 'Password has been reset successfully. Please log in with your new password.' };
}

export async function requestEmailVerification(userId: string): Promise<{ message: string }> {
  const user = await authRepo.findById(userId);
  if (!user) throw AppError.notFound('User not found');
  if (user.emailVerifiedAt) throw AppError.badRequest('Email is already verified');

  const token = await createEmailVerificationToken(userId);
  await emailQueue.add(
    'verify-email',
    { to: user.email, name: user.name, token },
    { jobId: `verify-email-${user.id}-${Date.now()}` },
  );

  return { message: 'Verification email has been sent.' };
}

export async function verifyEmail({
  token,
}: VerifyEmailDto): Promise<{ user: PublicUser; message: string }> {
  const userId = await verifyAndConsumeEmailVerificationToken(token);
  const user = await authRepo.markEmailVerified(userId);

  if (!user) throw AppError.notFound('User not found');
  await cache.del(`user:${userId}`);

  return { user, message: 'Email verified successfully.' };
}
