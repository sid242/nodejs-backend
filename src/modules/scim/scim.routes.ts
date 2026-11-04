import { Router } from 'express';

import { validate } from '@/middleware/validate';
import {
  createUser,
  deleteUser,
  getGroup,
  getSchemaById,
  getSchemas,
  getServiceProviderConfig,
  getUser,
  listGroups,
  listUsers,
  patchUser,
  updateUser,
} from './scim.controller';
import { scimCreateUserDto, scimPatchUserDto, scimQueryDto } from './scim.dto';
import { requireScimAuth } from './scim.middleware';

export const scimRouter = Router();

// Public discovery endpoints conforming to SCIM 2.0 specs
scimRouter.get('/ServiceProviderConfig', getServiceProviderConfig);
scimRouter.get('/Schemas', getSchemas);
scimRouter.get('/Schemas/:id', getSchemaById);

// Protected resource endpoints requiring SCIM Bearer token
scimRouter.use(requireScimAuth);

// User resource
scimRouter.get('/Users', validate({ query: scimQueryDto }), listUsers);
scimRouter.post('/Users', validate({ body: scimCreateUserDto }), createUser);
scimRouter.get('/Users/:id', getUser);
scimRouter.put('/Users/:id', validate({ body: scimCreateUserDto }), updateUser);
scimRouter.patch('/Users/:id', validate({ body: scimPatchUserDto }), patchUser);
scimRouter.delete('/Users/:id', deleteUser);

// Group resource
scimRouter.get('/Groups', validate({ query: scimQueryDto }), listGroups);
scimRouter.get('/Groups/:id', getGroup);

