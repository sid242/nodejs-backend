import type { Request, Response } from 'express';

import { createRedis } from '@/config/redis';
import { asyncHandler } from '@/lib/async-handler';
import { AppResponse } from '@/lib/responses';
import * as service from '@/modules/files/files.service';

export const listFiles = asyncHandler(async (req: Request, res: Response) => {
  const files = await service.listFiles(req.user!.id, req.tenant?.id);
  AppResponse.ok(files).send(res);
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

export const deleteFile = asyncHandler(async (req: Request, res: Response) => {
  await service.deleteFile(req.user!.id, req.valid?.params.id, req.tenant?.id);
  res.status(204).end();
});

export const streamEvents = (req: Request, res: Response): void => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(':connected\n\n');

  const subClient = createRedis(`sse-sub-${userId}`);
  const channel = `sse:user:${userId}`;

  void subClient.subscribe(channel);

  subClient.on('message', (chan, msg) => {
    if (chan === channel) {
      try {
        const parsed = JSON.parse(msg);
        res.write(
          `event: ${parsed?.event ?? 'message'}\ndata: ${JSON.stringify(parsed?.payload ?? {})}\n\n`,
        );
      } catch {
        res.write(`data: ${msg}\n\n`);
      }
    }
  });

  const keepAliveInterval = setInterval(() => {
    res.write(':ping\n\n');
  }, 25_000);

  req.on('close', () => {
    clearInterval(keepAliveInterval);
    void subClient.unsubscribe(channel).catch(() => {});
    void subClient.quit().catch(() => {});
  });
};
