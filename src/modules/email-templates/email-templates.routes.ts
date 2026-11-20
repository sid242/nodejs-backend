import { Router } from 'express';

import { requireAuth } from '@/middleware/auth';
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

// Delivery logs & Message tracking
router.get('/delivery-logs', validate({ query: listDeliveryLogsQueryDto }), controller.listDeliveryLogs);
router.get(
  '/delivery-logs/:id',
  validate({ params: deliveryLogIdParamDto }),
  controller.getDeliveryLog,
);

// Suppressions
router.get('/suppressions', validate({ query: listSuppressionsQueryDto }), controller.listSuppressions);
router.post('/suppressions', validate({ body: createSuppressionDto }), controller.createSuppression);
router.delete(
  '/suppressions/:id',
  validate({ params: suppressionIdParamDto }),
  controller.deleteSuppression,
);

// Template Version History & Rollback
router.get('/:id/versions', validate({ params: templateIdParamDto }), controller.listVersions);
router.post(
  '/:id/rollback/:version',
  validate({ params: templateIdAndVersionParamDto }),
  controller.rollbackVersion,
);

// Template Test Send
router.post(
  '/:id/test-send',
  validate({ params: templateIdParamDto, body: testSendEmailTemplateDto }),
  controller.testSend,
);

// Template CRUD
router.get('/', validate({ query: listEmailTemplatesQueryDto }), controller.listTemplates);
router.post('/', validate({ body: createEmailTemplateDto }), controller.createTemplate);
router.get('/:id', validate({ params: templateIdParamDto }), controller.getTemplate);
router.put(
  '/:id',
  validate({ params: templateIdParamDto, body: updateEmailTemplateDto }),
  controller.updateTemplate,
);
router.delete('/:id', validate({ params: templateIdParamDto }), controller.deleteTemplate);

export default router;
