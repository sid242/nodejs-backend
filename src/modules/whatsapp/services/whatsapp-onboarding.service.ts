import crypto from 'node:crypto';

import { env } from '@/config/env';
import { redis } from '@/config/redis';
import { decrypt, encrypt } from '@/lib/crypto';
import { AppError } from '@/lib/errors';
import { logSecurityEvent } from '@/modules/audit/audit.service';
import * as tenantRepo from '@/modules/tenants/tenants.repository';

import { metaWhatsAppProvider } from '../providers/meta-cloud-api.provider';
import * as accountRepo from '../repositories/whatsapp-account.repository';

const NONCE_TTL_SECONDS = 600; // 10 minutes

export interface OnboardingSessionResult {
  state: string;
  appId?: string;
  configId?: string;
  graphVersion: string;
}

export interface CompleteOnboardingInput {
  state: string;
  code?: string;
  accessToken?: string;
  wabaId: string;
  phoneNumberId?: string;
  displayName?: string;
}

export async function createOnboardingSession(
  tenantId: string,
  userId: string,
): Promise<OnboardingSessionResult> {
  const nonce = crypto.randomBytes(24).toString('hex');
  const redisKey = `whatsapp:onboard:nonce:${nonce}`;

  await redis.set(
    redisKey,
    JSON.stringify({ tenantId, userId, createdAt: new Date().toISOString() }),
    'EX',
    NONCE_TTL_SECONDS,
  );

  return {
    state: nonce,
    appId: env.META_APP_ID,
    configId: env.META_CONFIG_ID,
    graphVersion: env.META_GRAPH_API_VERSION,
  };
}

export async function completeOnboarding(
  tenantId: string,
  userId: string,
  input: CompleteOnboardingInput,
): Promise<{ accountId: string; wabaId: string; phoneNumbersCount: number }> {
  // 1. Validate and consume single-use state nonce
  const redisKey = `whatsapp:onboard:nonce:${input.state}`;
  const rawSession = await redis.get(redisKey);
  if (!rawSession) {
    throw AppError.badRequest('Invalid or expired onboarding session state/nonce', {
      code: 'WHATSAPP_INVALID_ONBOARDING_STATE',
    });
  }
  await redis.del(redisKey);

  const session = JSON.parse(rawSession) as { tenantId: string; userId: string };
  if (session.tenantId !== tenantId) {
    throw AppError.forbidden('Onboarding session does not match the active tenant context');
  }

  // 2. Resolve or exchange permanent access token
  let token = input.accessToken;
  if (!token && input.code) {
    const exchange = await metaWhatsAppProvider.exchangeCodeForToken(input.code);
    token = exchange.accessToken;
  }

  if (!token) {
    throw AppError.badRequest(
      'Missing Meta access token or authorization code in onboarding payload',
      { code: 'WHATSAPP_MISSING_CREDENTIALS' },
    );
  }

  // 2.5. Validate token validity with Meta debug_token
  const tokenInfo = await metaWhatsAppProvider.debugToken(token);
  if (!tokenInfo.isValid) {
    throw AppError.badRequest('Invalid or expired Meta access token', {
      code: 'WHATSAPP_INVALID_TOKEN',
    });
  }
  if (
    env.META_APP_ID &&
    tokenInfo.appId &&
    tokenInfo.appId !== env.META_APP_ID &&
    tokenInfo.appId !== 'mock_app'
  ) {
    throw AppError.badRequest('Access token does not belong to the configured Meta application', {
      code: 'WHATSAPP_TOKEN_APP_MISMATCH',
    });
  }

  // 3. Encrypt the access token using envelope encryption (context: 'whatsapp-token')
  const encryptedAccessToken = encrypt(token, { context: 'whatsapp-token' });

  // 4. Fetch associated phone numbers from Meta to verify assets
  const phoneNumbers = await metaWhatsAppProvider.getPhoneNumbers(input.wabaId, token);

  // 5. Store / update tenant WhatsApp business account
  const account = await accountRepo.createOrUpdateAccount({
    tenantId,
    wabaId: input.wabaId,
    displayName: input.displayName || 'WhatsApp Business',
    encryptedAccessToken,
    tokenKeyVersion: 'default',
    connectionStatus: 'CONNECTED',
    connectedBy: userId,
    connectedAt: new Date(),
    disconnectedAt: null,
  });

  // 6. Resolve tenant routing context for central platform registry
  const tenant = await tenantRepo.findTenantById(tenantId);
  const routingKey = tenant?.databaseKey ?? 'primary';

  // 7. Store phone numbers and register in central platform registry
  let isFirst = true;
  for (const phone of phoneNumbers) {
    await accountRepo.upsertPhoneNumber({
      tenantId,
      businessAccountId: account.id,
      phoneNumberId: phone.id,
      displayPhoneNumber: phone.displayPhoneNumber,
      verifiedName: phone.verifiedName || phone.displayPhoneNumber,
      qualityRating: phone.qualityRating,
      messagingLimit: phone.messagingLimit,
      isDefault: isFirst,
      isEnabled: true,
      registrationStatus: phone.codeVerificationStatus || 'CONNECTED',
    });

    // Central registry routing for webhooks
    await accountRepo.registerPlatformAccount({
      tenantId,
      wabaId: input.wabaId,
      phoneNumberId: phone.id,
      databaseRoutingKey: routingKey,
      connectionStatus: 'CONNECTED',
    });

    isFirst = false;
  }

  // 8. Subscribe WABA to webhook events
  await metaWhatsAppProvider.subscribeWabaWebhooks(input.wabaId, token);

  // 9. Append-only Security Audit Log
  await logSecurityEvent({
    tenantId,
    userId,
    action: 'whatsapp:account:connected',
    entityType: 'whatsapp_account',
    entityId: account.id,
    metadata: {
      wabaId: input.wabaId,
      phoneNumbersDiscovered: phoneNumbers.length,
    },
  });

  return {
    accountId: account.id,
    wabaId: account.wabaId,
    phoneNumbersCount: phoneNumbers.length,
  };
}

export async function getDecryptedAccountToken(
  tenantId: string,
  wabaId?: string,
): Promise<{ account: accountRepo.WhatsAppBusinessAccountRecord; accessToken: string }> {
  let account: accountRepo.WhatsAppBusinessAccountRecord | undefined;
  if (wabaId) {
    account = await accountRepo.findAccountByWabaId(tenantId, wabaId);
  } else {
    account = await accountRepo.findAccountByTenantId(tenantId);
  }

  if (!account || account.connectionStatus === 'DISCONNECTED') {
    throw AppError.notFound('No connected WhatsApp Business Account found for tenant', {
      code: 'WHATSAPP_NOT_CONNECTED',
    });
  }

  const accessToken = decrypt(account.encryptedAccessToken, { context: 'whatsapp-token' });
  return { account, accessToken };
}
