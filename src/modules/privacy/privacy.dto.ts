import { z } from 'zod';

export const requestUserDataExportDto = z.object({
  format: z.enum(['json', 'csv']).optional().default('json'),
});

export type RequestUserDataExportDto = z.infer<typeof requestUserDataExportDto>;

export const requestAccountDeletionDto = z.object({
  password: z.string().optional(),
  reason: z.string().max(500).optional(),
});

export type RequestAccountDeletionDto = z.infer<typeof requestAccountDeletionDto>;

export const cancelAccountDeletionDto = z.object({
  secret: z.string().optional(),
});

export type CancelAccountDeletionDto = z.infer<typeof cancelAccountDeletionDto>;

export const requestTenantClosureDto = z.object({
  slugConfirmation: z.string().min(1, 'Please confirm by typing the exact workspace slug'),
  reason: z.string().max(500).optional(),
});

export type RequestTenantClosureDto = z.infer<typeof requestTenantClosureDto>;

export const recordConsentDto = z.object({
  type: z.enum(['TERMS', 'PRIVACY', 'MARKETING', 'COOKIES']),
  version: z.string().min(1, 'Version is required'),
});

export type RecordConsentDto = z.infer<typeof recordConsentDto>;

export const placeLegalHoldDto = z.object({
  reason: z.string().min(5, 'Legal hold reason must be at least 5 characters').max(1000),
});

export type PlaceLegalHoldDto = z.infer<typeof placeLegalHoldDto>;

export const releaseLegalHoldDto = z.object({
  reason: z.string().max(1000).optional(),
});

export type ReleaseLegalHoldDto = z.infer<typeof releaseLegalHoldDto>;

export const createLegalDocumentDto = z.object({
  type: z.enum(['TERMS', 'PRIVACY', 'MARKETING', 'COOKIES']),
  version: z.string().min(1),
  title: z.string().min(1),
  url: z.string().url(),
  contentSummary: z.string().optional(),
  effectiveAt: z.string().datetime().optional(),
});

export type CreateLegalDocumentDto = z.infer<typeof createLegalDocumentDto>;
