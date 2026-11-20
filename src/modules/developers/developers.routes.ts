import { Router } from 'express';

import { requireAuth } from '@/middleware/auth';
import { authLimiter } from '@/middleware/rate-limit';
import { requirePermission } from '@/middleware/rbac';
import { validate } from '@/middleware/validate';

import * as controller from './developers.controller';
import * as dto from './developers.dto';
import { DEVELOPERS_PERMISSIONS } from './developers.permissions';

const router: Router = Router({ mergeParams: true });

router.use(requireAuth);

// ─── API Keys Routes ────────────────────────────────────────────────────────

router.get(
  '/api-keys',
  requirePermission(DEVELOPERS_PERMISSIONS.API_KEYS_READ),
  validate({ query: dto.listApiKeysQueryDto }),
  controller.listApiKeys,
);

router.post(
  '/api-keys',
  authLimiter,
  requirePermission(DEVELOPERS_PERMISSIONS.API_KEYS_MANAGE),
  validate({ body: dto.createApiKeyDto }),
  controller.createApiKey,
);

router.get(
  '/api-keys/:keyId',
  requirePermission(DEVELOPERS_PERMISSIONS.API_KEYS_READ),
  validate({ params: dto.apiKeyIdParamDto }),
  controller.getApiKey,
);

router.post(
  '/api-keys/:keyId/rotate',
  authLimiter,
  requirePermission(DEVELOPERS_PERMISSIONS.API_KEYS_MANAGE),
  validate({ params: dto.apiKeyIdParamDto }),
  controller.rotateApiKey,
);

router.delete(
  '/api-keys/:keyId',
  authLimiter,
  requirePermission(DEVELOPERS_PERMISSIONS.API_KEYS_MANAGE),
  validate({ params: dto.apiKeyIdParamDto }),
  controller.revokeApiKey,
);

// ─── Webhooks Routes ────────────────────────────────────────────────────────

router.get(
  '/webhooks',
  requirePermission(DEVELOPERS_PERMISSIONS.WEBHOOKS_READ),
  controller.listWebhookEndpoints,
);

router.post(
  '/webhooks',
  authLimiter,
  requirePermission(DEVELOPERS_PERMISSIONS.WEBHOOKS_MANAGE),
  validate({ body: dto.createWebhookEndpointDto }),
  controller.createWebhookEndpoint,
);

router.get(
  '/webhooks/:endpointId',
  requirePermission(DEVELOPERS_PERMISSIONS.WEBHOOKS_READ),
  validate({ params: dto.webhookEndpointIdParamDto }),
  controller.getWebhookEndpoint,
);

router.patch(
  '/webhooks/:endpointId',
  authLimiter,
  requirePermission(DEVELOPERS_PERMISSIONS.WEBHOOKS_MANAGE),
  validate({ params: dto.webhookEndpointIdParamDto, body: dto.updateWebhookEndpointDto }),
  controller.updateWebhookEndpoint,
);

router.delete(
  '/webhooks/:endpointId',
  authLimiter,
  requirePermission(DEVELOPERS_PERMISSIONS.WEBHOOKS_MANAGE),
  validate({ params: dto.webhookEndpointIdParamDto }),
  controller.deleteWebhookEndpoint,
);

router.post(
  '/webhooks/:endpointId/rotate-secret',
  authLimiter,
  requirePermission(DEVELOPERS_PERMISSIONS.WEBHOOKS_MANAGE),
  validate({ params: dto.webhookEndpointIdParamDto }),
  controller.rotateWebhookSecret,
);

router.get(
  '/webhooks/:endpointId/deliveries',
  requirePermission(DEVELOPERS_PERMISSIONS.WEBHOOKS_READ),
  validate({ params: dto.webhookEndpointIdParamDto, query: dto.listDeliveriesQueryDto }),
  controller.listWebhookDeliveries,
);

router.post(
  '/webhooks/:endpointId/deliveries/:deliveryId/redeliver',
  authLimiter,
  requirePermission(DEVELOPERS_PERMISSIONS.WEBHOOKS_MANAGE),
  validate({ params: dto.deliveryIdParamDto }),
  controller.redeliverWebhook,
);

router.post(
  '/webhooks/:endpointId/test',
  authLimiter,
  requirePermission(DEVELOPERS_PERMISSIONS.WEBHOOKS_MANAGE),
  validate({ params: dto.webhookEndpointIdParamDto }),
  controller.sendTestEvent,
);

export default router;
