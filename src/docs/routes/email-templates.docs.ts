import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { bearerAuth, errorResponse, successResponse } from '@/docs/helpers';
import {
  createEmailTemplateDto,
  createSuppressionDto,
  listDeliveryLogsQueryDto,
  listEmailTemplatesQueryDto,
  listSuppressionsQueryDto,
  testSendEmailTemplateDto,
  updateEmailTemplateDto,
} from '@/modules/email-templates/email-templates.dto';

export function registerEmailTemplatesDocs(registry: OpenAPIRegistry): void {
  const EmailTemplateSchema = registry.register(
    'EmailTemplate',
    z.object({
      id: z.string().uuid(),
      tenantId: z.string().uuid(),
      name: z.string(),
      slug: z.string(),
      locale: z.string(),
      subject: z.string(),
      category: z.string(),
      status: z.string(),
      description: z.string().nullable().optional(),
      senderName: z.string().nullable().optional(),
      fromEmail: z.string().nullable().optional(),
      replyTo: z.string().nullable().optional(),
      htmlContent: z.string(),
      variables: z.array(z.string()),
      currentVersion: z.number(),
      isSystemOverride: z.boolean(),
      createdAt: z.date(),
      updatedAt: z.date(),
    }),
  );

  const EmailTemplateVersionSchema = registry.register(
    'EmailTemplateVersion',
    z.object({
      id: z.string().uuid(),
      tenantId: z.string().uuid(),
      templateId: z.string().uuid(),
      version: z.number(),
      subject: z.string(),
      htmlContent: z.string(),
      variables: z.array(z.string()),
      createdAt: z.date(),
    }),
  );

  const EmailMessageSchema = registry.register(
    'EmailMessage',
    z.object({
      id: z.string().uuid(),
      tenantId: z.string().uuid(),
      templateId: z.string().uuid().nullable().optional(),
      templateSlug: z.string().nullable().optional(),
      to: z.string(),
      subject: z.string(),
      status: z.string(),
      provider: z.string().nullable().optional(),
      providerMessageId: z.string().nullable().optional(),
      attempts: z.number(),
      lastError: z.string().nullable().optional(),
      sentAt: z.date().nullable().optional(),
      createdAt: z.date(),
    }),
  );

  const EmailSuppressionSchema = registry.register(
    'EmailSuppression',
    z.object({
      id: z.string().uuid(),
      tenantId: z.string().uuid(),
      email: z.string(),
      reason: z.string(),
      details: z.string().nullable().optional(),
      createdAt: z.date(),
    }),
  );

  // List templates
  registry.registerPath({
    method: 'get',
    path: '/api/v1/email-templates',
    summary: 'List email templates',
    tags: ['Email Templates'],
    security: [{ [bearerAuth.name]: [] }],
    request: { query: listEmailTemplatesQueryDto },
    responses: {
      200: successResponse(
        z.object({ templates: z.array(EmailTemplateSchema), total: z.number() }),
      ),
      401: errorResponse('Unauthorized'),
    },
  });

  // Create template
  registry.registerPath({
    method: 'post',
    path: '/api/v1/email-templates',
    summary: 'Create email template',
    tags: ['Email Templates'],
    security: [{ [bearerAuth.name]: [] }],
    request: { body: { content: { 'application/json': { schema: createEmailTemplateDto } } } },
    responses: {
      201: successResponse(EmailTemplateSchema, 'Email template created'),
      400: errorResponse('Validation error'),
      401: errorResponse('Unauthorized'),
    },
  });

  // Get template
  registry.registerPath({
    method: 'get',
    path: '/api/v1/email-templates/{id}',
    summary: 'Get email template by ID',
    tags: ['Email Templates'],
    security: [{ [bearerAuth.name]: [] }],
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: {
      200: successResponse(EmailTemplateSchema),
      404: errorResponse('Template not found'),
    },
  });

  // Update template
  registry.registerPath({
    method: 'put',
    path: '/api/v1/email-templates/{id}',
    summary: 'Update email template',
    tags: ['Email Templates'],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      params: z.object({ id: z.string().uuid() }),
      body: { content: { 'application/json': { schema: updateEmailTemplateDto } } },
    },
    responses: {
      200: successResponse(EmailTemplateSchema, 'Template updated'),
      404: errorResponse('Template not found'),
    },
  });

  // Delete template
  registry.registerPath({
    method: 'delete',
    path: '/api/v1/email-templates/{id}',
    summary: 'Delete email template',
    tags: ['Email Templates'],
    security: [{ [bearerAuth.name]: [] }],
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: {
      200: successResponse(z.object({ message: z.string() })),
      404: errorResponse('Template not found'),
    },
  });

  // List versions
  registry.registerPath({
    method: 'get',
    path: '/api/v1/email-templates/{id}/versions',
    summary: 'List email template version snapshots',
    tags: ['Email Templates'],
    security: [{ [bearerAuth.name]: [] }],
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: {
      200: successResponse(z.array(EmailTemplateVersionSchema)),
    },
  });

  // Rollback version
  registry.registerPath({
    method: 'post',
    path: '/api/v1/email-templates/{id}/rollback/{version}',
    summary: 'Rollback email template to a previous version',
    tags: ['Email Templates'],
    security: [{ [bearerAuth.name]: [] }],
    request: { params: z.object({ id: z.string().uuid(), version: z.coerce.number() }) },
    responses: {
      200: successResponse(EmailTemplateSchema, 'Template restored to version'),
    },
  });

  // Test send
  registry.registerPath({
    method: 'post',
    path: '/api/v1/email-templates/{id}/test-send',
    summary: 'Send a test email with variable substitutions',
    tags: ['Email Templates'],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      params: z.object({ id: z.string().uuid() }),
      body: { content: { 'application/json': { schema: testSendEmailTemplateDto } } },
    },
    responses: {
      200: successResponse(
        z.object({ success: z.boolean(), message: z.string(), renderedSubject: z.string() }),
      ),
      403: errorResponse('Forbidden: test email must target user or active member'),
      429: errorResponse('Too Many Requests'),
    },
  });

  // Delivery logs
  registry.registerPath({
    method: 'get',
    path: '/api/v1/email-templates/delivery-logs',
    summary: 'List email delivery logs',
    tags: ['Email Delivery'],
    security: [{ [bearerAuth.name]: [] }],
    request: { query: listDeliveryLogsQueryDto },
    responses: {
      200: successResponse(z.object({ messages: z.array(EmailMessageSchema), total: z.number() })),
    },
  });

  // Suppressions
  registry.registerPath({
    method: 'get',
    path: '/api/v1/email-templates/suppressions',
    summary: 'List suppressed email addresses',
    tags: ['Email Suppressions'],
    security: [{ [bearerAuth.name]: [] }],
    request: { query: listSuppressionsQueryDto },
    responses: {
      200: successResponse(
        z.object({ suppressions: z.array(EmailSuppressionSchema), total: z.number() }),
      ),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/email-templates/suppressions',
    summary: 'Add an email address to the suppression list',
    tags: ['Email Suppressions'],
    security: [{ [bearerAuth.name]: [] }],
    request: { body: { content: { 'application/json': { schema: createSuppressionDto } } } },
    responses: {
      201: successResponse(EmailSuppressionSchema, 'Email address suppressed'),
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/api/v1/email-templates/suppressions/{id}',
    summary: 'Remove an email address from suppression list',
    tags: ['Email Suppressions'],
    security: [{ [bearerAuth.name]: [] }],
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: {
      200: successResponse(z.object({ message: z.string() })),
    },
  });
}
