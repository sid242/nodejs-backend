import { z } from 'zod';

export const ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/json',
  'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;

export const fileIdParamDto = z.object({
  id: z.string().uuid(),
});
export type FileIdParamDto = z.infer<typeof fileIdParamDto>;

export const folderIdParamDto = z.object({
  id: z.string().uuid(),
});
export type FolderIdParamDto = z.infer<typeof folderIdParamDto>;

export const shareIdParamDto = z.object({
  id: z.string().uuid(),
});
export type ShareIdParamDto = z.infer<typeof shareIdParamDto>;

export const fileAndShareIdParamDto = z.object({
  id: z.string().uuid(),
  shareId: z.string().uuid(),
});
export type FileAndShareIdParamDto = z.infer<typeof fileAndShareIdParamDto>;

export const shareTokenParamDto = z.object({
  token: z.string().min(16).max(128),
});
export type ShareTokenParamDto = z.infer<typeof shareTokenParamDto>;

export const requestUploadDto = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().refine((val) => (ALLOWED_TYPES as readonly string[]).includes(val), {
    message: 'Unsupported or disallowed file content type',
  }),
  folderId: z.string().uuid().optional().nullable(),
  description: z.string().max(1000).optional().nullable(),
  tags: z.array(z.string().min(1).max(50)).max(20).optional(),
});
export type RequestUploadDto = z.infer<typeof requestUploadDto>;

export const updateFileDto = z.object({
  filename: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional().nullable(),
  tags: z.array(z.string().min(1).max(50)).max(20).optional(),
  folderId: z.string().uuid().optional().nullable(),
  visibility: z.enum(['PRIVATE', 'TENANT', 'PUBLIC_LINK']).optional(),
});
export type UpdateFileDto = z.infer<typeof updateFileDto>;

export const createFolderDto = z.object({
  name: z.string().min(1).max(100),
  parentId: z.string().uuid().optional().nullable(),
  color: z.string().max(30).optional().nullable(),
});
export type CreateFolderDto = z.infer<typeof createFolderDto>;

export const updateFolderDto = z.object({
  name: z.string().min(1).max(100).optional(),
  parentId: z.string().uuid().optional().nullable(),
  color: z.string().max(30).optional().nullable(),
});
export type UpdateFolderDto = z.infer<typeof updateFolderDto>;

export const createShareDto = z.object({
  password: z.string().min(4).max(100).optional(),
  maxDownloads: z.number().int().min(1).max(10000).optional().nullable(),
  expiresInHours: z.number().int().min(1).max(720).optional(),
});
export type CreateShareDto = z.infer<typeof createShareDto>;

export const shareAccessDto = z.object({
  password: z.string().optional(),
});
export type ShareAccessDto = z.infer<typeof shareAccessDto>;

export const restoreVersionDto = z.object({
  versionNumber: z.number().int().min(1),
});
export type RestoreVersionDto = z.infer<typeof restoreVersionDto>;

export const listFilesQueryDto = z.object({
  folderId: z.string().optional(),
  search: z.string().max(100).optional(),
  tag: z.string().max(50).optional(),
  isDeleted: z
    .enum(['true', 'false'])
    .optional()
    .transform((val) => val === 'true'),
  scanStatus: z.enum(['PENDING', 'CLEAN', 'INFECTED', 'SKIPPED']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListFilesQueryDto = z.infer<typeof listFilesQueryDto>;
