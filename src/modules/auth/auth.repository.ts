import { eq } from 'drizzle-orm';

import { db } from '@/config/db';
import { publicUser, users, type PublicUser, type User } from '@/db/schema/index';

export interface CreateUserData {
  email: string;
  passwordHash?: string | null;
  firstName: string;
  lastName: string;
}

export async function createUser({
  email,
  passwordHash,
  firstName,
  lastName,
}: CreateUserData): Promise<PublicUser> {
  const [user] = await db
    .insert(users)
    .values({
      email: email.toLowerCase(),
      passwordHash,
      firstName,
      lastName: lastName ?? '',
    })
    .returning(publicUser);
  return user as PublicUser;
}

export async function findByEmail(email: string): Promise<User | null> {
  const [record] = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);
  return record ?? null;
}

export async function findPublicUserById(id: string): Promise<PublicUser | null> {
  const [user] = await db.select(publicUser).from(users).where(eq(users.id, id)).limit(1);
  return (user as PublicUser) ?? null;
}

export async function findById(id: string): Promise<User | null> {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return user ?? null;
}

export async function updatePassword(id: string, passwordHash: string): Promise<PublicUser | null> {
  const [user] = await db
    .update(users)
    .set({ passwordHash, passwordChangedAt: new Date() })
    .where(eq(users.id, id))
    .returning(publicUser);
  return (user as PublicUser) ?? null;
}

export async function markEmailVerified(id: string): Promise<PublicUser | null> {
  const [user] = await db
    .update(users)
    .set({ emailVerifiedAt: new Date(), status: 'ACTIVE' })
    .where(eq(users.id, id))
    .returning(publicUser);
  return (user as PublicUser) ?? null;
}

export async function enableTwoFactor(
  id: string,
  encryptedSecret: string,
  hashedRecoveryCodes: string[],
): Promise<void> {
  await db
    .update(users)
    .set({
      twoFactorSecret: encryptedSecret,
      twoFactorEnabledAt: new Date(),
      twoFactorRecoveryCodes: hashedRecoveryCodes,
    })
    .where(eq(users.id, id));
}

export async function disableTwoFactor(id: string): Promise<void> {
  await db
    .update(users)
    .set({
      twoFactorSecret: null,
      twoFactorEnabledAt: null,
      twoFactorRecoveryCodes: null,
    })
    .where(eq(users.id, id));
}

export async function updateRecoveryCodes(id: string, hashedCodes: string[]): Promise<void> {
  await db.update(users).set({ twoFactorRecoveryCodes: hashedCodes }).where(eq(users.id, id));
}

export async function updateLoginSuccess(id: string): Promise<void> {
  await db
    .update(users)
    .set({
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
      lastSeenAt: new Date(),
    })
    .where(eq(users.id, id));
}

export async function recordFailedLogin(
  id: string,
  attempts: number,
  lockedUntil?: Date | null,
): Promise<void> {
  await db
    .update(users)
    .set({
      failedLoginAttempts: attempts,
      lockedUntil: lockedUntil ?? null,
      lastSeenAt: new Date(),
    })
    .where(eq(users.id, id));
}
