import { Router } from 'express';
import { validate } from '@/middleware/validate.js';
import { requireAuth } from '@/middleware/auth.js';
import { uploadLimiter } from '@/middleware/rate-limit.js';
import { fileIdParamDto, requestUploadDto } from '@/modules/files/files.dto.js';
import * as controller from '@/modules/files/files.controller.js';

const router = Router();
router.use(requireAuth);

router.get('/', controller.listFiles);
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
