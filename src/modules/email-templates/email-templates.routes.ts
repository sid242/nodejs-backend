import { Router } from 'express';

import { requireAuth } from '@/middleware/auth';
import { requirePermission } from '@/middleware/rbac';
import { resolveTenantContext } from '@/middleware/tenant';
import { validate } from '@/middleware/validate';

import * as controller from './email-templates.controller';
import {
  bounceWebhookDto,
  createEmailTemplateDto,
  createSuppressionDto,
  deliveryLogIdParamDto,
  listDeliveryLogsQueryDto,
  listEmailTemplatesQueryDto,
  listSuppressionsQueryDto,
  suppressionIdParamDto,
  templateIdAndVersionParamDto,
  templateIdParamDto,
  testSendEmailTemplateDto,
  updateEmailTemplateDto,
} from './email-templates.dto';

const router = Router();

// Public webhook route (SNS / SMTP bounce notifications)
router.post('/webhook/bounce', validate({ body: bounceWebhookDto }), controller.bounceWebhook);

// Authenticated tenant routes
router.use(requireAuth);
router.use(resolveTenantContext);

const emailRead = requirePermission('email-templates:read');
const emailWrite = requirePermission('email-templates:write');
const emailDelete = requirePermission('email-templates:delete');

// Delivery logs & Message tracking
router.get(
  '/delivery-logs',
  emailRead,
  validate({ query: listDeliveryLogsQueryDto }),
  controller.listDeliveryLogs,
);
router.get(
  '/delivery-logs/:id',
  emailRead,
  validate({ params: deliveryLogIdParamDto }),
  controller.getDeliveryLog,
);

// Suppressions
router.get(
  '/suppressions',
  emailRead,
  validate({ query: listSuppressionsQueryDto }),
  controller.listSuppressions,
);
router.post(
  '/suppressions',
  emailWrite,
  validate({ body: createSuppressionDto }),
  controller.createSuppression,
);
router.delete(
  '/suppressions/:id',
  emailDelete,
  validate({ params: suppressionIdParamDto }),
  controller.deleteSuppression,
);

// Template Version History & Rollback
router.get(
  '/:id/versions',
  emailRead,
  validate({ params: templateIdParamDto }),
  controller.listVersions,
);
router.post(
  '/:id/rollback/:version',
  emailWrite,
  validate({ params: templateIdAndVersionParamDto }),
  controller.rollbackVersion,
);

// Template Test Send
router.post(
  '/:id/test-send',
  emailWrite,
  validate({ params: templateIdParamDto, body: testSendEmailTemplateDto }),
  controller.testSend,
);

// Template CRUD
router.get(
  '/',
  emailRead,
  validate({ query: listEmailTemplatesQueryDto }),
  controller.listTemplates,
);
router.post('/', emailWrite, validate({ body: createEmailTemplateDto }), controller.createTemplate);
router.get('/:id', emailRead, validate({ params: templateIdParamDto }), controller.getTemplate);
router.put(
  '/:id',
  emailWrite,
  validate({ params: templateIdParamDto, body: updateEmailTemplateDto }),
  controller.updateTemplate,
);
router.delete(
  '/:id',
  emailDelete,
  validate({ params: templateIdParamDto }),
  controller.deleteTemplate,
);

export default router;
