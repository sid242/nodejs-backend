import { Request, Response } from 'express';

import { asyncHandler } from '@/lib/async-handler';
import { AppResponse } from '@/lib/responses';

import { CreatePolicyDto, ListPoliciesQueryDto, UpdatePolicyDto } from './policies.dto';
import { policiesService } from './policies.service';

export const listPolicies = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const filters = (req.valid?.query ?? req.query) as ListPoliciesQueryDto;
  const result = await policiesService.listPolicies(tenantId, filters);

  res.json(
    AppResponse.ok(result.items, 'OK', {
      total: result.total,
      page: result.page,
      limit: result.limit,
    }),
  );
});

export const getPolicy = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const policyId = (req.valid?.params?.policyId ?? req.params.policyId) as string;
  const policy = await policiesService.getPolicyById(tenantId, policyId);

  res.json(AppResponse.ok(policy));
});

export const createPolicy = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const body = (req.valid?.body ?? req.body) as CreatePolicyDto;
  const created = await policiesService.createPolicy(tenantId, body, req.user?.id);

  res.status(201).json(AppResponse.created(created, 'Policy created successfully'));
});

export const updatePolicy = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const policyId = (req.valid?.params?.policyId ?? req.params.policyId) as string;
  const body = (req.valid?.body ?? req.body) as UpdatePolicyDto;
  const updated = await policiesService.updatePolicy(tenantId, policyId, body, req.user?.id);

  res.json(AppResponse.ok(updated, 'Policy updated successfully'));
});

export const deletePolicy = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const policyId = (req.valid?.params?.policyId ?? req.params.policyId) as string;
  await policiesService.deletePolicy(tenantId, policyId);

  res.json(AppResponse.ok(null, 'Policy deleted successfully'));
});

export const attachPolicyToRole = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const { policyId, roleId } = (req.valid?.params ?? req.params) as {
    policyId: string;
    roleId: string;
  };
  const result = await policiesService.attachPolicyToRole(tenantId, policyId, roleId);

  res.json(AppResponse.ok(null, result.message));
});

export const detachPolicyFromRole = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const { policyId, roleId } = (req.valid?.params ?? req.params) as {
    policyId: string;
    roleId: string;
  };
  const result = await policiesService.detachPolicyFromRole(tenantId, policyId, roleId);

  res.json(AppResponse.ok(null, result.message));
});

export const getPoliciesForRole = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const roleId = (req.valid?.params?.roleId ?? req.params.roleId) as string;
  const policies = await policiesService.getPoliciesForRole(tenantId, roleId);

  res.json(AppResponse.ok(policies));
});
