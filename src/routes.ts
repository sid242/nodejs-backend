import { Router } from 'express';

import authRoutes from '@/modules/auth/auth.routes.js';
import fileRoutes from '@/modules/files/files.routes.js';
import rbacRoutes from '@/modules/rbac/rbac.routes.js';
import tenantRoutes from '@/modules/tenants/tenants.routes.js';
import userRoutes from '@/modules/users/users.routes.js';

const router: Router = Router();
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/files', fileRoutes);
router.use('/tenants', tenantRoutes);
router.use('/rbac', rbacRoutes);

export default router;
