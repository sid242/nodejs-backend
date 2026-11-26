import { AppError } from '@/lib/errors';
import { logSecurityEvent } from '@/modules/audit/audit.service';

import { metaWhatsAppProvider } from '../providers/meta-cloud-api.provider';
import * as accountRepo from '../repositories/whatsapp-account.repository';
import { getDecryptedAccountToken } from './whatsapp-onboarding.service';

export interface WhatsAppAccountResponse {
  id: string;
  tenantId: string;
  wabaId: string;
  businessId?: string | null;
  displayName: string;
  connectionStatus: string;
  connectedAt?: Date | null;
  disconnectedAt?: Date | null;
  createdAt: Date;
}

export async function getAccount(tenantId: string): Promise<WhatsAppAccountResponse | null> {
  const account = await accountRepo.findAccountByTenantId(tenantId);
  if (!account) return null;

  return {
    id: account.id,
    tenantId: account.tenantId,
    wabaId: account.wabaId,
    businessId: account.businessId,
    displayName: account.displayName,
    connectionStatus: account.connectionStatus,
    connectedAt: account.connectedAt,
    disconnectedAt: account.disconnectedAt,
    createdAt: account.createdAt,
  };
}

export async function getPhoneNumbers(tenantId: string) {
  return accountRepo.listPhoneNumbers(tenantId);
}

export async function setDefaultPhoneNumber(
  tenantId: string,
  userId: string,
  phoneNumberId: string,
): Promise<void> {
  const phone = await accountRepo.findPhoneNumberByProviderId(tenantId, phoneNumberId);
  if (!phone) {
    throw AppError.notFound('Phone number not found', {
      code: 'WHATSAPP_PHONE_NUMBER_NOT_FOUND',
    });
  }

  await accountRepo.setDefaultPhoneNumber(tenantId, phoneNumberId);

  await logSecurityEvent({
    tenantId,
    userId,
    action: 'whatsapp:phone_number:default_updated',
    entityType: 'whatsapp_phone_number',
    entityId: phone.id,
    metadata: { phoneNumberId, displayPhoneNumber: phone.displayPhoneNumber },
  });
}

export async function setPhoneNumberEnabled(
  tenantId: string,
  userId: string,
  id: string,
  isEnabled: boolean,
) {
  const updated = await accountRepo.updatePhoneNumberStatus(tenantId, id, isEnabled);
  if (!updated) {
    throw AppError.notFound('Phone number not found', {
      code: 'WHATSAPP_PHONE_NUMBER_NOT_FOUND',
    });
  }

  await logSecurityEvent({
    tenantId,
    userId,
    action: 'whatsapp:phone_number:status_updated',
    entityType: 'whatsapp_phone_number',
    entityId: id,
    metadata: { isEnabled },
  });

  return updated;
}

export async function disconnectAccount(tenantId: string, userId: string, accountId: string) {
  // 1. Unsubscribe WABA webhooks if credentials are still present
  try {
    const { account, accessToken } = await getDecryptedAccountToken(tenantId);
    if (account?.wabaId && accessToken) {
      await metaWhatsAppProvider.unsubscribeWabaWebhooks(account.wabaId, accessToken);
    }
  } catch {
    // If already disconnected or credentials unavailable, proceed to local cleanup
  }

  // 2. Mark account DISCONNECTED, wipe token, and update registry
  const disconnected = await accountRepo.disconnectAccount(tenantId, accountId);
  if (!disconnected) {
    throw AppError.notFound('WhatsApp account not found', {
      code: 'WHATSAPP_ACCOUNT_NOT_FOUND',
    });
  }

  await logSecurityEvent({
    tenantId,
    userId,
    action: 'whatsapp:account:disconnected',
    entityType: 'whatsapp_account',
    entityId: accountId,
  });

  return disconnected;
}

export async function refreshAccountStatus(tenantId: string, userId: string) {
  const { account, accessToken } = await getDecryptedAccountToken(tenantId);
  const remoteNumbers = await metaWhatsAppProvider.getPhoneNumbers(account.wabaId, accessToken);

  for (const p of remoteNumbers) {
    await accountRepo.upsertPhoneNumber({
      tenantId,
      businessAccountId: account.id,
      phoneNumberId: p.id,
      displayPhoneNumber: p.displayPhoneNumber,
      verifiedName: p.verifiedName || p.displayPhoneNumber,
      qualityRating: p.qualityRating,
      messagingLimit: p.messagingLimit,
      isDefault: false,
      isEnabled: true,
      registrationStatus: p.codeVerificationStatus || 'CONNECTED',
    });
  }

  await logSecurityEvent({
    tenantId,
    userId,
    action: 'whatsapp:account:refreshed',
    entityType: 'whatsapp_account',
    entityId: account.id,
    metadata: { phoneNumbersRefreshed: remoteNumbers.length },
  });

  return { success: true, count: remoteNumbers.length };
}
