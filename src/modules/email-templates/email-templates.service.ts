import type { EmailTemplate } from '@/db/schema/index';
import { AppError } from '@/lib/errors';
import { sendEmail } from '@/lib/mailer';

import type {
  CreateEmailTemplateDto,
  ListEmailTemplatesQueryDto,
  TestSendEmailTemplateDto,
  UpdateEmailTemplateDto,
} from './email-templates.dto';
import * as repo from './email-templates.repository';

export function extractVariables(html: string, subject = ''): string[] {
  const combined = `${html} ${subject}`;
  const matches = combined.match(/\{\{([a-zA-Z0-9_]+)\}\}/g) || [];
  return Array.from(new Set(matches.map((m) => m.replace(/\{\{|\}\}/g, '').trim()))).filter(
    Boolean,
  );
}

export function renderVariables(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key) => {
    return variables[key] !== undefined ? variables[key] : `{{${key}}}`;
  });
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export async function listTemplates(tenantId: string, options: ListEmailTemplatesQueryDto) {
  return repo.findTemplatesByTenant(tenantId, options);
}

export async function getTemplate(id: string, tenantId: string): Promise<EmailTemplate> {
  const template = await repo.findTemplateById(id, tenantId);
  if (!template) {
    throw AppError.notFound('Email template not found');
  }
  return template;
}

export async function createTemplate(
  tenantId: string,
  userId: string,
  data: CreateEmailTemplateDto,
): Promise<EmailTemplate> {
  const baseSlug = data.slug || generateSlug(data.name);
  let finalSlug = baseSlug;

  const existing = await repo.findTemplateBySlug(finalSlug, tenantId);
  if (existing) {
    finalSlug = `${baseSlug}-${Date.now().toString().slice(-4)}`;
  }

  const detectedVariables = Array.from(
    new Set([...extractVariables(data.htmlContent, data.subject), ...(data.variables || [])]),
  );

  return repo.createTemplate({
    tenantId,
    name: data.name,
    slug: finalSlug,
    subject: data.subject,
    category: data.category,
    status: data.status,
    description: data.description,
    senderName: data.senderName,
    fromEmail: data.fromEmail,
    replyTo: data.replyTo,
    htmlContent: data.htmlContent,
    designJson: data.designJson,
    variables: detectedVariables,
    createdById: userId,
  });
}

export async function updateTemplate(
  id: string,
  tenantId: string,
  data: UpdateEmailTemplateDto,
): Promise<EmailTemplate> {
  const existing = await getTemplate(id, tenantId);

  const html = data.htmlContent ?? existing.htmlContent;
  const subject = data.subject ?? existing.subject;
  const detectedVariables = Array.from(
    new Set([...extractVariables(html, subject), ...(data.variables || existing.variables || [])]),
  );

  const updated = await repo.updateTemplate(id, tenantId, {
    ...data,
    variables: detectedVariables,
  });

  if (!updated) {
    throw AppError.notFound('Email template not found');
  }
  return updated;
}

export async function deleteTemplate(id: string, tenantId: string): Promise<{ success: boolean }> {
  const deleted = await repo.deleteTemplate(id, tenantId);
  if (!deleted) {
    throw AppError.notFound('Email template not found');
  }
  return { success: true };
}

export async function testSendTemplate(
  id: string,
  tenantId: string,
  data: TestSendEmailTemplateDto,
): Promise<{ success: boolean; message: string; renderedSubject: string }> {
  const template = await getTemplate(id, tenantId);

  const renderedSubject = renderVariables(template.subject, data.variables || {});
  const renderedHtml = renderVariables(template.htmlContent, data.variables || {});

  await sendEmail({
    to: data.to,
    subject: renderedSubject,
    html: renderedHtml,
    tenantId,
    fromName: template.senderName ?? undefined,
    fromEmail: template.fromEmail ?? undefined,
    replyTo: template.replyTo ?? undefined,
  });

  return {
    success: true,
    message: `Test email sent to ${data.to}`,
    renderedSubject,
  };
}
