import type { Request, Response } from 'express';

import { asyncHandler } from '@/lib/async-handler';
import { AppResponse } from '@/lib/responses';
import type { SearchQueryDto } from './search.dto';
import * as service from './search.service';

export const handleGlobalSearch = asyncHandler(
  async (req: Request, res: Response) => {
    const query = req.query as unknown as SearchQueryDto;
    const permissions = (req as any).permissions ?? [];
    const result = await service.globalSearch(
      query,
      req.tenant?.id,
      permissions,
    );
    res.json(AppResponse.ok(result));
  },
);
