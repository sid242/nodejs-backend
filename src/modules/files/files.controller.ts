import type { Request, Response } from 'express';

import { env } from '@/config/env';
import { createRedis } from '@/config/redis';
import { asyncHandler } from '@/lib/async-handler';
import { AppError } from '@/lib/errors';
import { AppResponse } from '@/lib/responses';
import * as service from '@/modules/files/files.service';
import { findTenantById, findTenantMember } from '@/modules/tenants/tenants.repository';

export const listFiles = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.listFiles(req.user!.id, req.tenant?.id, req.valid?.query);
  AppResponse.ok(result).send(res);
});

export const requestUpload = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.requestUpload(req.user!.id, req.valid?.body, req.tenant?.id);
  AppResponse.created(result, 'Upload requested').send(res);
});

export const confirmUpload = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.confirmUpload(req.user!.id, req.valid?.params.id, req.tenant?.id);
  AppResponse.ok(result, 'Upload confirmed').send(res);
});

export const getDownloadUrl = asyncHandler(async (req: Request, res: Response) => {
  const disposition = req.query.disposition === 'inline' ? 'inline' : 'attachment';
  const result = await service.getDownloadUrl(
    req.user!.id,
    (req.valid?.params?.id ?? req.params.id) as string,
    req.tenant?.id,
    disposition,
  );
  AppResponse.ok(result).send(res);
});

export const updateFile = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.updateFile(
    req.user!.id,
    req.valid?.params.id,
    req.tenant?.id,
    req.valid?.body,
  );
  AppResponse.ok(result, 'File updated').send(res);
});

export const deleteFile = asyncHandler(async (req: Request, res: Response) => {
  const permanent = req.query.permanent === 'true';
  await service.deleteFile(req.user!.id, req.valid?.params.id, req.tenant?.id, permanent);
  res.status(204).end();
});

export const restoreFile = asyncHandler(async (req: Request, res: Response) => {
  if (!req.tenant?.id) throw AppError.badRequest('Tenant context required');
  const result = await service.restoreFile(req.user!.id, req.valid?.params.id, req.tenant.id);
  AppResponse.ok(result, 'File restored').send(res);
});

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

export const listFolders = asyncHandler(async (req: Request, res: Response) => {
  if (!req.tenant?.id) throw AppError.badRequest('Tenant context required');
  const parentId = typeof req.query.parentId === 'string' ? req.query.parentId : undefined;
  const folders = await service.listFolders(req.tenant.id, parentId);
  AppResponse.ok(folders).send(res);
});

export const createFolder = asyncHandler(async (req: Request, res: Response) => {
  if (!req.tenant?.id) throw AppError.badRequest('Tenant context required');
  const folder = await service.createFolder(req.user!.id, req.tenant.id, req.valid?.body);
  AppResponse.created(folder, 'Folder created').send(res);
});

export const getFolder = asyncHandler(async (req: Request, res: Response) => {
  if (!req.tenant?.id) throw AppError.badRequest('Tenant context required');
  const folder = await service.getFolder(req.tenant.id, req.valid?.params.id);
  AppResponse.ok(folder).send(res);
});

export const updateFolder = asyncHandler(async (req: Request, res: Response) => {
  if (!req.tenant?.id) throw AppError.badRequest('Tenant context required');
  const folder = await service.updateFolder(req.tenant.id, req.valid?.params.id, req.valid?.body);
  AppResponse.ok(folder, 'Folder updated').send(res);
});

export const deleteFolder = asyncHandler(async (req: Request, res: Response) => {
  if (!req.tenant?.id) throw AppError.badRequest('Tenant context required');
  await service.deleteFolder(req.tenant.id, req.valid?.params.id);
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Shares
// ---------------------------------------------------------------------------

export const createShare = asyncHandler(async (req: Request, res: Response) => {
  if (!req.tenant?.id) throw AppError.badRequest('Tenant context required');
  const share = await service.createShare(
    req.user!.id,
    req.tenant.id,
    req.valid?.params.id,
    req.valid?.body,
  );
  AppResponse.created(share, 'Share link created').send(res);
});

export const listShares = asyncHandler(async (req: Request, res: Response) => {
  if (!req.tenant?.id) throw AppError.badRequest('Tenant context required');
  const shares = await service.listShares(req.user!.id, req.tenant.id, req.valid?.params.id);
  AppResponse.ok(shares).send(res);
});

export const revokeShare = asyncHandler(async (req: Request, res: Response) => {
  if (!req.tenant?.id) throw AppError.badRequest('Tenant context required');
  const fileId = (req.valid?.params?.id ?? req.params.id) as string;
  const shareId = (req.valid?.params?.shareId ?? req.params.shareId) as string;
  await service.revokeShare(req.user!.id, req.tenant.id, fileId, shareId);
  res.status(204).end();
});

export const accessShare = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.accessShare(req.valid?.params.token, req.body?.password);
  AppResponse.ok(result).send(res);
});

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

export const listVersions = asyncHandler(async (req: Request, res: Response) => {
  if (!req.tenant?.id) throw AppError.badRequest('Tenant context required');
  const versions = await service.listVersions(req.user!.id, req.tenant.id, req.valid?.params.id);
  AppResponse.ok(versions).send(res);
});

export const restoreVersion = asyncHandler(async (req: Request, res: Response) => {
  if (!req.tenant?.id) throw AppError.badRequest('Tenant context required');
  const result = await service.restoreVersion(
    req.user!.id,
    req.tenant.id,
    req.valid?.params.id,
    req.valid?.body.versionNumber,
  );
  AppResponse.ok(result, 'Version restored').send(res);
});

// ---------------------------------------------------------------------------
// Storage Analytics
// ---------------------------------------------------------------------------

export const getStorageStats = asyncHandler(async (req: Request, res: Response) => {
  if (!req.tenant?.id) throw AppError.badRequest('Tenant context required');
  const stats = await service.getStorageStats(req.tenant.id);
  AppResponse.ok(stats).send(res);
});

// ---------------------------------------------------------------------------
// Realtime SSE
// ---------------------------------------------------------------------------

export const streamEvents = (req: Request, res: Response): void => {
  const userId = req.user?.id;
  const tenantId = req.tenant?.id;
  if (!userId || !tenantId) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    return;
  }
  if (req.isSupportSession) {
    res
      .status(403)
      .json({ error: { code: 'FORBIDDEN', message: 'File streams require a workspace member' } });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(':connected\n\n');

  const subClient = createRedis(`sse-sub-${userId}`, { url: env.SOCKET_REDIS_URL });
  const channel = 'sse:workspace-user:' + tenantId + ':' + userId;

  void subClient.subscribe(channel).catch(() => res.end());

  subClient.on('message', (chan, msg) => {
    if (chan === channel) {
      try {
        const parsed = JSON.parse(msg);
        if (parsed?.event === 'workspace:revoked') {
          res.end();
          return;
        }
        res.write(
          `event: ${parsed?.event ?? 'message'}\ndata: ${JSON.stringify(parsed?.payload ?? {})}\n\n`,
        );
      } catch {
        res.write(`data: ${msg}\n\n`);
      }
    }
  });

  const keepAliveInterval = setInterval(() => {
    void Promise.all([findTenantById(tenantId), findTenantMember(tenantId, userId)])
      .then(([tenant, member]) => {
        if (res.writableEnded) return;
        if (
          !tenant ||
          tenant.deletedAt ||
          !['ACTIVE', 'TRIALING'].includes(tenant.status) ||
          member?.status !== 'ACTIVE'
        ) {
          res.end();
          return;
        }
        res.write(':ping\n\n');
      })
      .catch(() => res.end());
  }, 25_000);

  res.on('close', () => {
    clearInterval(keepAliveInterval);
    subClient.disconnect();
  });
};
