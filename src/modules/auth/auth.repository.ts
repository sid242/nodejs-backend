import { eq } from 'drizzle-orm';
import { db } from '@/config/db.js';
import { publicUser, users, type User, type PublicUser } from '@/db/schema/index.js';

export interface CreateUserData {
  email: string;
  passwordHash: string;
  name: string;
}

export async function createUser({
  email,
  passwordHash,
  name,
}: CreateUserData): Promise<PublicUser> {
  const [user] = await db
    .insert(users)
    .values({ email: email.toLowerCase(), passwordHash, name })
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
    .set({ passwordHash })
    .where(eq(users.id, id))
    .returning(publicUser);
  return (user as PublicUser) ?? null;
}

export async function markEmailVerified(id: string): Promise<PublicUser | null> {
  const [user] = await db
    .update(users)
    .set({ emailVerifiedAt: new Date() })
    .where(eq(users.id, id))
    .returning(publicUser);
  return (user as PublicUser) ?? null;
}
