import { AppError } from '@/lib/errors';
import { logSecurityEvent } from '@/modules/audit/audit.service';

import { metaWhatsAppProvider } from '../providers/meta-cloud-api.provider';
import * as templateRepo from '../repositories/whatsapp-template.repository';
import type {
  TemplateComponentDefinition,
  WhatsAppTemplateCategory,
} from '../types/whatsapp-provider.types';
import { getDecryptedAccountToken } from './whatsapp-onboarding.service';

export interface CreateTemplateDto {
  name: string;
  category: WhatsAppTemplateCategory;
  language?: string;
  components: TemplateComponentDefinition[];
}

export interface UpdateTemplateDto {
  category?: WhatsAppTemplateCategory;
  components?: TemplateComponentDefinition[];
}

export async function listTemplates(filters: templateRepo.ListTemplatesFilters) {
  return templateRepo.listTemplates(filters);
}

export async function getTemplateById(tenantId: string, id: string) {
  const template = await templateRepo.findTemplateById(tenantId, id);
  if (!template) {
    throw AppError.notFound('WhatsApp template not found', {
      code: 'WHATSAPP_TEMPLATE_NOT_FOUND',
    });
  }
  return template;
}

export async function createDraftTemplate(
  tenantId: string,
  userId: string,
  dto: CreateTemplateDto,
) {
  const { account } = await getDecryptedAccountToken(tenantId);

  // Normalize template name (Meta requires lowercase alphanumeric + underscore)
  const normalizedName = dto.name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]/g, '_');
  const language = dto.language || 'en';

  // Check unique name & language constraint
  const existing = await templateRepo.findTemplateByName(tenantId, normalizedName, language);
  if (existing) {
    throw AppError.conflict(
      `Template '${normalizedName}' with language '${language}' already exists`,
      { code: 'WHATSAPP_TEMPLATE_EXISTS' },
    );
  }

  const created = await templateRepo.createTemplate({
    tenantId,
    businessAccountId: account.id,
    name: normalizedName,
    category: dto.category,
    requestedCategory: dto.category,
    language,
    components: dto.components as unknown as Record<string, unknown>[],
    status: 'DRAFT',
    createdBy: userId,
    updatedBy: userId,
  });

  await logSecurityEvent({
    tenantId,
    userId,
    action: 'whatsapp:template:created',
    entityType: 'whatsapp_template',
    entityId: created.id,
    metadata: { name: normalizedName, category: dto.category, language },
  });

  return created;
}

export async function updateTemplate(
  tenantId: string,
  userId: string,
  id: string,
  dto: UpdateTemplateDto,
) {
  const existing = await getTemplateById(tenantId, id);

  if (existing.status === 'SUBMITTED' || existing.status === 'PENDING') {
    throw AppError.badRequest('Cannot edit a template that is pending Meta approval');
  }

  const updated = await templateRepo.updateTemplate(tenantId, id, {
    category: dto.category ?? existing.category,
    components: dto.components
      ? (dto.components as unknown as Record<string, unknown>[])
      : existing.components,
    updatedBy: userId,
  });

  await logSecurityEvent({
    tenantId,
    userId,
    action: 'whatsapp:template:updated',
    entityType: 'whatsapp_template',
    entityId: id,
    metadata: { name: existing.name },
  });

  return updated;
}

export async function submitTemplateToMeta(tenantId: string, userId: string, id: string) {
  const template = await getTemplateById(tenantId, id);
  const { account, accessToken } = await getDecryptedAccountToken(tenantId);

  // Call Meta message_templates endpoint
  const metaResult = await metaWhatsAppProvider.createTemplate({
    wabaId: account.wabaId,
    accessToken,
    name: template.name,
    category: template.category as WhatsAppTemplateCategory,
    language: template.language,
    components: template.components as unknown as TemplateComponentDefinition[],
  });

  const updated = await templateRepo.updateTemplate(tenantId, id, {
    metaTemplateId: metaResult.id,
    status: metaResult.status || 'PENDING',
    approvedCategory: metaResult.category,
    submittedAt: new Date(),
    updatedBy: userId,
  });

  await logSecurityEvent({
    tenantId,
    userId,
    action: 'whatsapp:template:submitted',
    entityType: 'whatsapp_template',
    entityId: id,
    metadata: {
      name: template.name,
      metaTemplateId: metaResult.id,
      status: metaResult.status,
    },
  });

  return updated;
}

export async function syncTemplates(tenantId: string, userId: string) {
  const { account, accessToken } = await getDecryptedAccountToken(tenantId);
  const remoteTemplates = await metaWhatsAppProvider.getTemplates({
    wabaId: account.wabaId,
    accessToken,
  });

  let syncedCount = 0;
  for (const remote of remoteTemplates) {
    const existing = await templateRepo.findTemplateByName(tenantId, remote.name, remote.language);
    if (existing) {
      await templateRepo.updateTemplate(tenantId, existing.id, {
        metaTemplateId: remote.id,
        status: remote.status,
        approvedCategory: remote.category,
        rejectionReason: remote.rejectionReason,
        qualityRating: remote.qualityRating,
        lastSyncedAt: new Date(),
      });
      syncedCount++;
    } else {
      // Create local copy from remote
      await templateRepo.createTemplate({
        tenantId,
        businessAccountId: account.id,
        metaTemplateId: remote.id,
        name: remote.name,
        category: remote.category,
        requestedCategory: remote.category,
        approvedCategory: remote.category,
        language: remote.language,
        components: (remote.components ?? []) as unknown as Record<string, unknown>[],
        status: remote.status,
        rejectionReason: remote.rejectionReason,
        qualityRating: remote.qualityRating,
        lastSyncedAt: new Date(),
        createdBy: userId,
      });
      syncedCount++;
    }
  }

  await logSecurityEvent({
    tenantId,
    userId,
    action: 'whatsapp:templates:synced',
    entityType: 'whatsapp_template',
    entityId: account.id,
    metadata: { syncedCount },
  });

  return { success: true, count: syncedCount };
}

export async function deleteTemplate(tenantId: string, userId: string, id: string) {
  const template = await getTemplateById(tenantId, id);
  const { account, accessToken } = await getDecryptedAccountToken(tenantId);

  // If already submitted to Meta, delete remotely
  if (template.metaTemplateId) {
    try {
      await metaWhatsAppProvider.deleteTemplate({
        wabaId: account.wabaId,
        accessToken,
        name: template.name,
        templateId: template.metaTemplateId,
      });
    } catch {
      // If template already removed from Meta, proceed with local deletion
    }
  }

  await templateRepo.deleteTemplate(tenantId, id);

  await logSecurityEvent({
    tenantId,
    userId,
    action: 'whatsapp:template:deleted',
    entityType: 'whatsapp_template',
    entityId: id,
    metadata: { name: template.name, metaTemplateId: template.metaTemplateId },
  });

  return { success: true };
}
