import { Router } from 'express';

import addressRoutes from '@/modules/addresses/addresses.routes';
import authRoutes from '@/modules/auth/auth.routes';
import * as billingController from '@/modules/billing/billing.controller';
import billingRoutes from '@/modules/billing/billing.routes';
import emailTemplateRoutes from '@/modules/email-templates/email-templates.routes';
import fileRoutes from '@/modules/files/files.routes';
import geoRoutes from '@/modules/geo/geo.routes';
import groupRoutes from '@/modules/groups/groups.routes';
import internalRoutes from '@/modules/internal/internal.routes';
import platformRoutes from '@/modules/platform/platform.routes';
import rbacRoutes from '@/modules/rbac/rbac.routes';
import { scimRouter } from '@/modules/scim/scim.routes';
import { ssoAuthRouter } from '@/modules/sso/sso.routes';
import tenantRoutes from '@/modules/tenants/tenants.routes';
import userRoutes from '@/modules/users/users.routes';

const router: Router = Router();
router.use('/auth/sso', ssoAuthRouter);
router.use('/auth', authRoutes);
router.use('/scim/v2', scimRouter);
router.use('/users', userRoutes);
router.use('/files', fileRoutes);
router.use('/tenants', tenantRoutes);
router.use('/groups', groupRoutes);
router.use('/rbac', rbacRoutes);
router.use('/platform', platformRoutes);
router.use('/email-templates', emailTemplateRoutes);
router.use('/billing', billingRoutes);
router.use('/plans', billingRoutes);
router.post('/webhooks/razorpay', billingController.handleBillingWebhook);
router.use('/internal', internalRoutes);
router.use('/geo', geoRoutes);
router.use('/addresses', addressRoutes);
router.get('/public/plans', billingController.listPublicPlans);

export default router;
