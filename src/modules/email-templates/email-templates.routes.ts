import { Router } from 'express';

import { requireAuth } from '@/middleware/auth';
import { resolveTenantContext } from '@/middleware/tenant';
import { validate } from '@/middleware/validate';

import * as controller from './email-templates.controller';
import {
  createEmailTemplateDto,
  listEmailTemplatesQueryDto,
  templateIdParamDto,
  testSendEmailTemplateDto,
  updateEmailTemplateDto,
} from './email-templates.dto';

const router = Router();
router.use(requireAuth);
router.use(resolveTenantContext);

router.get('/', validate({ query: listEmailTemplatesQueryDto }), controller.listTemplates);
router.post('/', validate({ body: createEmailTemplateDto }), controller.createTemplate);
router.get('/:id', validate({ params: templateIdParamDto }), controller.getTemplate);
router.put(
  '/:id',
  validate({ params: templateIdParamDto, body: updateEmailTemplateDto }),
  controller.updateTemplate,
);
router.delete('/:id', validate({ params: templateIdParamDto }), controller.deleteTemplate);
router.post(
  '/:id/test-send',
  validate({ params: templateIdParamDto, body: testSendEmailTemplateDto }),
  controller.testSend,
);

export default router;
