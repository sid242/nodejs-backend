import { z } from 'zod';
import { fileIdParamDto, requestUploadDto } from '../../modules/files/files.dto.js';
import { bearerAuth, errorResponse, successResponse } from '../helpers.js';

export function registerFilesDocs(registry) {
  const FileSchema = registry.register(
    'File',
    z.object({
      id: z.string().uuid().openapi({ example: 'd3b07384-d113-40f4-9ed3-2051d95e6cf1' }),
      filename: z.string().openapi({ example: 'document.pdf' }),
      contentType: z.string().openapi({ example: 'application/pdf' }),
      sizeBytes: z.number().nullable().openapi({ example: 1048576 }),
      status: z.enum(['PENDING', 'READY', 'DELETED']).openapi({ example: 'READY' }),
      createdAt: z.string().datetime().openapi({ example: '2026-01-15T09:00:00.000Z' }),
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
    }),
  );

  // --- Files Routes ---
  registry.registerPath({
    method: 'get',
    path: '/api/v1/files',
    summary: 'List user files',
    description: 'Returns list of files uploaded by the authenticated user.',
    tags: ['Files'],
    security: [{ [bearerAuth.name]: [] }],
    responses: {
      200: successResponse(z.array(FileSchema), 'List of user files'),
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
      'Verifies that the object exists in S3, marks file as READY, and queues background virus/thumbnail processing.',
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
    method: 'delete',
    path: '/api/v1/files/{id}',
    summary: 'Delete file',
    description: 'Deletes object from S3 storage and deletes database record.',
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
}
