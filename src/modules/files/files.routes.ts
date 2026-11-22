import { Router } from 'express';

import { requireAuth } from '@/middleware/auth';
import { uploadLimiter } from '@/middleware/rate-limit';
import { requirePermission } from '@/middleware/rbac';
import { resolveTenantContext } from '@/middleware/tenant';
import { validate } from '@/middleware/validate';
import * as controller from '@/modules/files/files.controller';
import {
  createFolderDto,
  createShareDto,
  fileAndShareIdParamDto,
  fileIdParamDto,
  folderIdParamDto,
  listFilesQueryDto,
  requestUploadDto,
  restoreVersionDto,
  shareAccessDto,
  shareTokenParamDto,
  updateFileDto,
  updateFolderDto,
} from '@/modules/files/files.dto';

const router = Router();

// Public route: Access shared file by expiring token (unauthenticated or with password)
router.post(
  '/shares/:token',
  validate({ params: shareTokenParamDto, body: shareAccessDto }),
  controller.accessShare,
);
router.get('/shares/:token', validate({ params: shareTokenParamDto }), controller.accessShare);

// Protected routes
router.use(requireAuth);
router.use(resolveTenantContext);

const fileRead = requirePermission('files:read');
const fileWrite = requirePermission('files:write');
const fileDelete = requirePermission('files:delete');

router.use((req, res, next) => {
  // Personal operations still require ownership through the service.
  if (!req.tenant) return next();
  if (req.method === 'GET' || req.method === 'HEAD') return fileRead(req, res, next);
  if (req.method === 'DELETE' && !req.path.includes('/shares/')) {
    return fileDelete(req, res, next);
  }
  return fileWrite(req, res, next);
});

// Realtime events
router.get('/events/stream', controller.streamEvents);

// Storage analytics
router.get('/stats', controller.getStorageStats);

// Folder routes
router.get('/folders', controller.listFolders);
router.post('/folders', validate({ body: createFolderDto }), controller.createFolder);
router.get('/folders/:id', validate({ params: folderIdParamDto }), controller.getFolder);
router.patch(
  '/folders/:id',
  validate({ params: folderIdParamDto, body: updateFolderDto }),
  controller.updateFolder,
);
router.delete('/folders/:id', validate({ params: folderIdParamDto }), controller.deleteFolder);

// Files CRUD
router.get('/', validate({ query: listFilesQueryDto }), controller.listFiles);
router.post(
  '/upload-url',
  uploadLimiter,
  validate({ body: requestUploadDto }),
  controller.requestUpload,
);
router.post('/:id/confirm', validate({ params: fileIdParamDto }), controller.confirmUpload);
router.get('/:id/download-url', validate({ params: fileIdParamDto }), controller.getDownloadUrl);
router.patch(
  '/:id',
  validate({ params: fileIdParamDto, body: updateFileDto }),
  controller.updateFile,
);
router.delete('/:id', validate({ params: fileIdParamDto }), controller.deleteFile);
router.post('/:id/restore', validate({ params: fileIdParamDto }), controller.restoreFile);

// File Shares
router.post(
  '/:id/shares',
  validate({ params: fileIdParamDto, body: createShareDto }),
  controller.createShare,
);
router.get('/:id/shares', validate({ params: fileIdParamDto }), controller.listShares);
router.delete(
  '/:id/shares/:shareId',
  validate({ params: fileAndShareIdParamDto }),
  controller.revokeShare,
);

// File Versions
router.get('/:id/versions', validate({ params: fileIdParamDto }), controller.listVersions);
router.post(
  '/:id/versions/restore',
  validate({ params: fileIdParamDto, body: restoreVersionDto }),
  controller.restoreVersion,
);

export default router;
