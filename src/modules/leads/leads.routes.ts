import { Router } from 'express';

import { requireAuth } from '@/middleware/auth';
import { requireTenant } from '@/middleware/tenant';
import { validate } from '@/middleware/validate';
import { requireModule } from '@/modules/optional-modules/availability';
import { requirePolicy } from '@/modules/pbac/pbac.middleware';

import * as controller from './leads.controller';
import * as dto from './leads.dto';
import { leadsRepo } from './leads.repository';

const router: Router = Router();

// All leads routes require user authentication and tenant resolution
router.use(requireAuth, requireTenant, requireModule('leads'));

router.get(
  '/',
  requirePolicy({ resource: 'leads', action: 'read' }),
  validate({ query: dto.listLeadsQueryDto }),
  controller.listLeads,
);

router.post(
  '/',
  validate({ body: dto.createLeadDto }),
  requirePolicy({
    resource: 'leads',
    action: 'create',
    getTargetResource: (req) => (req.valid?.body ?? req.body) as Record<string, unknown>,
  }),
  controller.createLead,
);

router.get(
  '/:leadId',
  validate({ params: dto.leadIdParamDto }),
  requirePolicy({
    resource: 'leads',
    action: 'read',
    getTargetResource: (req) =>
      leadsRepo.findLeadById(
        req.tenant!.id,
        String(req.valid?.params?.leadId ?? req.params.leadId),
        req.db,
      ),
  }),
  controller.getLead,
);

router.patch(
  '/:leadId',
  validate({ params: dto.leadIdParamDto, body: dto.updateLeadDto }),
  requirePolicy({
    resource: 'leads',
    action: 'update',
    getTargetResource: (req) =>
      leadsRepo.findLeadById(
        req.tenant!.id,
        String(req.valid?.params?.leadId ?? req.params.leadId),
        req.db,
      ),
  }),
  controller.updateLead,
);

router.delete(
  '/:leadId',
  validate({ params: dto.leadIdParamDto }),
  requirePolicy({
    resource: 'leads',
    action: 'delete',
    getTargetResource: (req) =>
      leadsRepo.findLeadById(
        req.tenant!.id,
        String(req.valid?.params?.leadId ?? req.params.leadId),
        req.db,
      ),
  }),
  controller.deleteLead,
);

export default router;
