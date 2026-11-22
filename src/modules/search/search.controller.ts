import type { Request, Response } from 'express';

import { asyncHandler } from '@/lib/async-handler';
import { AppResponse } from '@/lib/responses';
import { isModuleAvailable } from '@/modules/optional-modules/availability';
import { optionalModules } from '@/modules/optional-modules/registry';
import { pbacService } from '@/modules/pbac/pbac.service';

import type { SearchItem, SearchQueryDto } from './search.dto';
import * as service from './search.service';

export const handleGlobalSearch = asyncHandler(async (req: Request, res: Response) => {
  const query = req.valid?.query ?? (req.query as unknown as SearchQueryDto);
  const permissions = req.permissions ?? [];
  const extraPages: SearchItem[] = [];
  if (
    req.tenant &&
    (!query.types || query.types.includes('pages')) &&
    (await isModuleAvailable('leads', req.tenant.id))
  ) {
    const canRead =
      permissions.includes('*') ||
      (
        await pbacService.getPossiblePermissions(
          req.tenant.id,
          req.membership?.roleIds ?? [],
          'leads',
        )
      ).includes('leads:read');
    if (canRead) extraPages.push(optionalModules.leads.searchPage);
  }
  const result = await service.globalSearch(query, req.tenant?.id, permissions, extraPages);
  res.json(AppResponse.ok(result));
});
