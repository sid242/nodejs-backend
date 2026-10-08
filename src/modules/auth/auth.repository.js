import { eq } from 'drizzle-orm';
import { db } from '../../config/db.js';
import { publicUser, users } from '../../db/schema/index.js';

export async function createUser({ email, passwordHash, name }) {
  const [user] = await db
    .insert(users)
    .values({ email: email.toLowerCase(), passwordHash, name })
    .returning(publicUser);
  return user;
}

export async function findByEmail(email) {
  const [record] = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);
  return record ?? null;
}

export async function findPublicUserById(id) {
  const [user] = await db.select(publicUser).from(users).where(eq(users.id, id)).limit(1);
  return user ?? null;
}

export async function findById(id) {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return user ?? null;
}

export async function updatePassword(id, passwordHash) {
  const [user] = await db
    .update(users)
    .set({ passwordHash })
    .where(eq(users.id, id))
    .returning(publicUser);
  return user ?? null;
}

export async function markEmailVerified(id) {
  const [user] = await db
    .update(users)
    .set({ emailVerifiedAt: new Date() })
    .where(eq(users.id, id))
    .returning(publicUser);
  return user ?? null;
}
