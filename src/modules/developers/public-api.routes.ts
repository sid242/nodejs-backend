import { Router, type Request, type Response } from 'express';

import { asyncHandler } from '@/lib/async-handler';
import { AppResponse } from '@/lib/responses';
import { requireApiKey, requireApiKeyScope } from '@/middleware/api-key';
import * as fileRepo from '@/modules/files/files.repository';
import * as tenantsRepo from '@/modules/tenants/tenants.repository';

const router: Router = Router();

// Enforce API key authentication across all /v1 routes
router.use(requireApiKey);

/**
 * GET /v1/me
 * Returns the authenticated workspace and API key identity.
 */
router.get(
  '/me',
  asyncHandler(async (req: Request, res: Response) => {
    return AppResponse.ok({
      tenant: req.tenant,
      apiKey: {
        id: req.apiKey?.id,
        name: req.apiKey?.name,
        prefix: req.apiKey?.prefix,
        scopes: req.apiKey?.scopes,
      },
    }).send(res);
  }),
);

/**
 * GET /v1/members
 * Lists active workspace team members.
 */
router.get(
  '/members',
  requireApiKeyScope('members:read'),
  asyncHandler(async (req: Request, res: Response) => {
    const tenantId = req.tenant!.id;
    const members = await tenantsRepo.findTenantMembers(tenantId);
    return AppResponse.ok(members).send(res);
  }),
);

/**
 * GET /v1/files
 * Lists uploaded workspace files.
 */
router.get(
  '/files',
  requireApiKeyScope('files:read'),
  asyncHandler(async (req: Request, res: Response) => {
    const tenantId = req.tenant!.id;
    const page = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10));
    const limit = Math.min(100, Math.max(1, Number.parseInt(String(req.query.limit || '20'), 10)));
    const offset = (page - 1) * limit;

    const result = await fileRepo.findFiles({
      tenantId,
      limit,
      offset,
    });

    return AppResponse.ok(result.items, undefined, {
      total: result.total,
      page,
      limit,
    }).send(res);
  }),
);

export default router;
