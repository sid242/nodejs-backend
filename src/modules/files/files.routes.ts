import { Router } from 'express';

import { requireAuth } from '@/middleware/auth';
import { uploadLimiter } from '@/middleware/rate-limit';
import { resolveTenantContext } from '@/middleware/tenant';
import { validate } from '@/middleware/validate';
import * as controller from '@/modules/files/files.controller';
import { fileIdParamDto, requestUploadDto } from '@/modules/files/files.dto';

const router = Router();
router.use(requireAuth);
router.use(resolveTenantContext);

router.get('/', controller.listFiles);
router.get('/events/stream', controller.streamEvents);
router.post(
  '/upload-url',
  uploadLimiter,
  validate({ body: requestUploadDto }),
  controller.requestUpload,
);
router.post('/:id/confirm', validate({ params: fileIdParamDto }), controller.confirmUpload);
router.get('/:id/download-url', validate({ params: fileIdParamDto }), controller.getDownloadUrl);
router.delete('/:id', validate({ params: fileIdParamDto }), controller.deleteFile);

export default router;
