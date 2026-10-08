import { Router } from 'express';
import authRoutes from '@/modules/auth/auth.routes.js';
import userRoutes from '@/modules/users/users.routes.js';
import fileRoutes from '@/modules/files/files.routes.js';

const router: Router = Router();
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/files', fileRoutes);

export default router;
