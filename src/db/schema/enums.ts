import { pgEnum } from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('Role', ['USER', 'ADMIN']);
export const fileStatusEnum = pgEnum('FileStatus', ['PENDING', 'UPLOADED']);
