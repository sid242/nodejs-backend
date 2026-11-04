import { z } from 'zod';

export const createInvitationDto = z
  .object({
    email: z.string().trim().email(),
    roleId: z.string().uuid().optional(),
    role: z.string().trim().optional(),
    firstName: z.string().trim().max(50).optional(),
    lastName: z.string().trim().max(50).optional(),
    phone: z.string().trim().max(30).optional(),
    memberCode: z.string().trim().max(50).optional(),
    jobTitle: z.string().trim().max(100).optional(),
    department: z.string().trim().max(100).optional(),
    message: z.string().trim().max(1000).optional(),
    expiresInHours: z.coerce.number().int().min(1).max(168).default(48),
  })
  .refine((data) => Boolean(data.roleId || data.role), {
    message: 'Either roleId or role name must be specified',
  });

export type CreateInvitationDto = z.infer<typeof createInvitationDto>;

export const acceptInvitationDto = z.object({
  token: z.string().trim().min(1, 'Invitation token is required'),
  name: z.string().trim().min(1).max(100).optional(),
  password: z.string().min(8, 'Password must be at least 8 characters').optional(),
});

export type AcceptInvitationDto = z.infer<typeof acceptInvitationDto>;

export const previewInvitationQueryDto = z.object({
  token: z.string().trim().min(1, 'Token query parameter is required'),
});

export type PreviewInvitationQueryDto = z.infer<typeof previewInvitationQueryDto>;
