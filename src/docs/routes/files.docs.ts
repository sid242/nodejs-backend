import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { bearerAuth, errorResponse, successResponse } from '@/docs/helpers';
import {
  createFolderDto,
  createShareDto,
  fileIdParamDto,
  folderIdParamDto,
  requestUploadDto,
  restoreVersionDto,
  updateFileDto,
  updateFolderDto,
} from '@/modules/files/files.dto';

export function registerFilesDocs(registry: OpenAPIRegistry): void {
  const FileSchema = registry.register(
    'File',
    z.object({
      id: z.string().uuid().openapi({ example: 'd3b07384-d113-40f4-9ed3-2051d95e6cf1' }),
      filename: z.string().openapi({ example: 'document.pdf' }),
      contentType: z.string().openapi({ example: 'application/pdf' }),
      size: z.number().nullable().openapi({ example: 1048576 }),
      status: z.enum(['PENDING', 'UPLOADED']).openapi({ example: 'UPLOADED' }),
      folderId: z.string().uuid().nullable().optional(),
      scanStatus: z.enum(['PENDING', 'CLEAN', 'INFECTED', 'SKIPPED']).openapi({ example: 'CLEAN' }),
      visibility: z.enum(['PRIVATE', 'TENANT', 'PUBLIC_LINK']).openapi({ example: 'PRIVATE' }),
      version: z.number().openapi({ example: 1 }),
      isDeleted: z.boolean().openapi({ example: false }),
      tags: z.array(z.string()).optional(),
      downloadCount: z.number().openapi({ example: 3 }),
      createdAt: z.string().datetime().openapi({ example: '2026-01-15T09:00:00.000Z' }),
    }),
  );

  const FolderSchema = registry.register(
    'FileFolder',
    z.object({
      id: z.string().uuid(),
      name: z.string().openapi({ example: 'Marketing Assets' }),
      parentId: z.string().uuid().nullable().optional(),
      color: z.string().nullable().optional(),
      createdAt: z.string().datetime(),
    }),
  );

  const FileShareSchema = registry.register(
    'FileShare',
    z.object({
      id: z.string().uuid(),
      fileId: z.string().uuid(),
      tokenHash: z.string(),
      maxDownloads: z.number().nullable().optional(),
      downloadCount: z.number(),
      expiresAt: z.string().datetime().nullable().optional(),
      createdAt: z.string().datetime(),
    }),
  );

  const FileVersionSchema = registry.register(
    'FileVersion',
    z.object({
      id: z.string().uuid(),
      fileId: z.string().uuid(),
      versionNumber: z.number(),
      size: z.number().nullable(),
      createdAt: z.string().datetime(),
    }),
  );

  const FileUploadRequestInput = registry.register('FileUploadRequestInput', requestUploadDto);

  const PresignedPostData = registry.register(
    'PresignedPostData',
    z.object({
      fileId: z.string().uuid().openapi({ example: 'd3b07384-d113-40f4-9ed3-2051d95e6cf1' }),
      upload: z.object({
        url: z.string().url().openapi({ example: 'https://my-bucket.s3.amazonaws.com/' }),
        fields: z.record(z.string()).openapi({ description: 'Form fields for S3 direct POST' }),
      }),
    }),
  );

  const DownloadUrlData = registry.register(
    'DownloadUrlData',
    z.object({
      url: z.string().url().openapi({ description: 'Short-lived presigned S3 download URL' }),
      expiresInSeconds: z.number().openapi({ example: 300 }),
    }),
  );

  // --- Files Routes ---
  registry.registerPath({
    method: 'get',
    path: '/api/v1/files',
    summary: 'List tenant files',
    description: 'Returns list of files uploaded in current tenant workspace with folder, search, and pagination support.',
    tags: ['Files'],
    security: [{ [bearerAuth.name]: [] }],
    responses: {
      200: successResponse(z.object({ items: z.array(FileSchema), total: z.number() }), 'List of tenant files'),
      401: errorResponse('Unauthorized'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/files/upload-url',
    summary: 'Request direct S3 upload URL',
    description:
      'Creates a pending file record and returns short-lived AWS S3 presigned POST credentials for direct client-to-S3 upload.',
    tags: ['Files'],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      body: {
        description: 'Upload request details',
        content: { 'application/json': { schema: FileUploadRequestInput } },
      },
    },
    responses: {
      201: successResponse(PresignedPostData, 'Presigned upload URL created'),
      400: errorResponse('Invalid file parameters or unsupported content type'),
      401: errorResponse('Unauthorized'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/files/{id}/confirm',
    summary: 'Confirm uploaded file',
    description:
      'Verifies that the object exists in S3, marks file as UPLOADED, and queues background virus/thumbnail processing.',
    tags: ['Files'],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      params: fileIdParamDto,
    },
    responses: {
      200: successResponse(FileSchema, 'File confirmed and ready'),
      400: errorResponse('File not found in S3 storage'),
      401: errorResponse('Unauthorized'),
      404: errorResponse('File record not found'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/files/{id}/download-url',
    summary: 'Get S3 presigned download URL',
    description:
      'Generates a short-lived presigned GET URL for downloading the file directly from S3.',
    tags: ['Files'],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      params: fileIdParamDto,
    },
    responses: {
      200: successResponse(DownloadUrlData, 'Presigned download URL'),
      401: errorResponse('Unauthorized'),
      404: errorResponse('File not found'),
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/api/v1/files/{id}',
    summary: 'Update file metadata',
    description: 'Updates file filename, description, tags, folder, or visibility.',
    tags: ['Files'],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      params: fileIdParamDto,
      body: { content: { 'application/json': { schema: updateFileDto } } },
    },
    responses: {
      200: successResponse(FileSchema, 'File updated successfully'),
      401: errorResponse('Unauthorized'),
      404: errorResponse('File not found'),
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/api/v1/files/{id}',
    summary: 'Delete file',
    description: 'Soft-deletes file to trash by default, or permanently deletes if ?permanent=true is provided.',
    tags: ['Files'],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      params: fileIdParamDto,
    },
    responses: {
      204: { description: 'File deleted successfully' },
      401: errorResponse('Unauthorized'),
      404: errorResponse('File not found'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/files/{id}/restore',
    summary: 'Restore file from trash',
    description: 'Restores a soft-deleted file back to active workspace status.',
    tags: ['Files'],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      params: fileIdParamDto,
    },
    responses: {
      200: successResponse(FileSchema, 'File restored'),
      401: errorResponse('Unauthorized'),
      404: errorResponse('File not found'),
    },
  });

  // --- Folder Routes ---
  registry.registerPath({
    method: 'get',
    path: '/api/v1/files/folders',
    summary: 'List folders',
    description: 'Returns list of folders in tenant workspace.',
    tags: ['Files - Folders'],
    security: [{ [bearerAuth.name]: [] }],
    responses: {
      200: successResponse(z.array(FolderSchema), 'List of folders'),
      401: errorResponse('Unauthorized'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/files/folders',
    summary: 'Create folder',
    description: 'Creates a new folder for organizing files.',
    tags: ['Files - Folders'],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      body: { content: { 'application/json': { schema: createFolderDto } } },
    },
    responses: {
      201: successResponse(FolderSchema, 'Folder created'),
      401: errorResponse('Unauthorized'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/files/folders/{id}',
    summary: 'Get folder detail',
    tags: ['Files - Folders'],
    security: [{ [bearerAuth.name]: [] }],
    request: { params: folderIdParamDto },
    responses: {
      200: successResponse(FolderSchema, 'Folder details'),
      404: errorResponse('Folder not found'),
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/api/v1/files/folders/{id}',
    summary: 'Update folder',
    tags: ['Files - Folders'],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      params: folderIdParamDto,
      body: { content: { 'application/json': { schema: updateFolderDto } } },
    },
    responses: {
      200: successResponse(FolderSchema, 'Folder updated'),
      404: errorResponse('Folder not found'),
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/api/v1/files/folders/{id}',
    summary: 'Delete folder',
    tags: ['Files - Folders'],
    security: [{ [bearerAuth.name]: [] }],
    request: { params: folderIdParamDto },
    responses: {
      204: { description: 'Folder deleted successfully' },
      404: errorResponse('Folder not found'),
    },
  });

  // --- Share Routes ---
  registry.registerPath({
    method: 'post',
    path: '/api/v1/files/{id}/shares',
    summary: 'Create file share link',
    description: 'Creates a public expiring share link with optional password and download count cap.',
    tags: ['Files - Sharing'],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      params: fileIdParamDto,
      body: { content: { 'application/json': { schema: createShareDto } } },
    },
    responses: {
      201: successResponse(
        z.object({
          shareId: z.string().uuid(),
          token: z.string(),
          expiresAt: z.string().datetime().nullable(),
          maxDownloads: z.number().nullable(),
        }),
        'Share link created',
      ),
      401: errorResponse('Unauthorized'),
      404: errorResponse('File not found'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/files/{id}/shares',
    summary: 'List shares for file',
    tags: ['Files - Sharing'],
    security: [{ [bearerAuth.name]: [] }],
    request: { params: fileIdParamDto },
    responses: {
      200: successResponse(z.array(FileShareSchema), 'Active file shares'),
      401: errorResponse('Unauthorized'),
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/api/v1/files/{id}/shares/{shareId}',
    summary: 'Revoke share link',
    tags: ['Files - Sharing'],
    security: [{ [bearerAuth.name]: [] }],
    responses: {
      204: { description: 'Share revoked successfully' },
      401: errorResponse('Unauthorized'),
    },
  });

  // --- Version Routes ---
  registry.registerPath({
    method: 'get',
    path: '/api/v1/files/{id}/versions',
    summary: 'List file versions',
    tags: ['Files - Versions'],
    security: [{ [bearerAuth.name]: [] }],
    request: { params: fileIdParamDto },
    responses: {
      200: successResponse(z.array(FileVersionSchema), 'List of versions'),
      401: errorResponse('Unauthorized'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/files/{id}/versions/restore',
    summary: 'Restore previous file version',
    tags: ['Files - Versions'],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      params: fileIdParamDto,
      body: { content: { 'application/json': { schema: restoreVersionDto } } },
    },
    responses: {
      200: successResponse(FileSchema, 'Version restored'),
      401: errorResponse('Unauthorized'),
      404: errorResponse('Version not found'),
    },
  });

  // --- Storage Analytics ---
  registry.registerPath({
    method: 'get',
    path: '/api/v1/files/stats',
    summary: 'Get storage usage analytics',
    description: 'Returns total bytes, file count, and category breakdown for tenant workspace.',
    tags: ['Files - Storage'],
    security: [{ [bearerAuth.name]: [] }],
    responses: {
      200: successResponse(
        z.object({
          totalBytes: z.number(),
          totalFiles: z.number(),
          deletedFiles: z.number(),
          categoryBreakdown: z.array(
            z.object({
              category: z.string(),
              bytes: z.number(),
              count: z.number(),
            }),
          ),
        }),
        'Storage analytics',
      ),
      401: errorResponse('Unauthorized'),
    },
  });
}
