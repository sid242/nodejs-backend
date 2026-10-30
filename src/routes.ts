import { Router } from 'express';

import authRoutes from '@/modules/auth/auth.routes';
import * as billingController from '@/modules/billing/billing.controller';
import billingRoutes from '@/modules/billing/billing.routes';
import emailTemplateRoutes from '@/modules/email-templates/email-templates.routes';
import fileRoutes from '@/modules/files/files.routes';
import platformRoutes from '@/modules/platform/platform.routes';
import rbacRoutes from '@/modules/rbac/rbac.routes';
import tenantRoutes from '@/modules/tenants/tenants.routes';
import userRoutes from '@/modules/users/users.routes';

const router: Router = Router();
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/files', fileRoutes);
router.use('/tenants', tenantRoutes);
router.use('/rbac', rbacRoutes);
router.use('/platform', platformRoutes);
router.use('/email-templates', emailTemplateRoutes);
router.use('/billing', billingRoutes);
router.use('/plans', billingRoutes);
router.get('/public/plans', billingController.listPublicPlans);

export default router;
