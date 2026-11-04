import { z } from 'zod';

export const scimUserEmailDto = z.object({
  value: z.string().email(),
  primary: z.boolean().optional(),
  type: z.string().optional(),
});

export const scimUserNameDto = z.object({
  formatted: z.string().optional(),
  familyName: z.string().optional(),
  givenName: z.string().optional(),
  middleName: z.string().optional(),
});

export const scimCreateUserDto = z.object({
  schemas: z.array(z.string()).optional(),
  userName: z.string().email('userName must be a valid email'),
  name: scimUserNameDto.optional(),
  displayName: z.string().optional(),
  emails: z.array(scimUserEmailDto).optional(),
  active: z.boolean().default(true),
  externalId: z.string().optional(),
  roles: z.array(z.object({ value: z.string() })).optional(),
});

export const scimPatchOperationDto = z.object({
  op: z.enum(['add', 'replace', 'remove', 'Add', 'Replace', 'Remove']),
  path: z.string().optional(),
  value: z.any().optional(),
});

export const scimPatchUserDto = z.object({
  schemas: z.array(z.string()).optional(),
  Operations: z.array(scimPatchOperationDto),
});

export const scimQueryDto = z.object({
  filter: z.string().optional(),
  startIndex: z.coerce.number().int().min(1).default(1),
  count: z.coerce.number().int().min(1).max(100).default(50),
});

export type ScimCreateUserDto = z.infer<typeof scimCreateUserDto>;
export type ScimPatchUserDto = z.infer<typeof scimPatchUserDto>;
export type ScimQueryDto = z.infer<typeof scimQueryDto>;

