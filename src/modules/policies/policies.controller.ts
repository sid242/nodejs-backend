import { Request, Response } from 'express';

import { asyncHandler } from '@/lib/async-handler';
import { AppResponse } from '@/lib/responses';
import { PBAC_REGISTRY } from '@/modules/pbac/pbac.registry';

import {
  CreatePolicyDto,
  EvaluatePolicyDto,
  ListPoliciesQueryDto,
  UpdatePolicyDto,
} from './policies.dto';
import { policiesService } from './policies.service';

export const getPolicyRegistry = asyncHandler(async (_req: Request, res: Response) => {
  res.json(AppResponse.ok(PBAC_REGISTRY));
});

export const evaluateDryRun = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const body = (req.valid?.body ?? req.body) as EvaluatePolicyDto;
  const result = await policiesService.dryRunEvaluation(tenantId, body);

  res.json(AppResponse.ok(result));
});

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
  await policiesService.deletePolicy(tenantId, policyId, req.user?.id);

  res.json(AppResponse.ok(null, 'Policy deleted successfully'));
});

export const attachPolicyToRole = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const { policyId, roleId } = (req.valid?.params ?? req.params) as {
    policyId: string;
    roleId: string;
  };
  const result = await policiesService.attachPolicyToRole(tenantId, policyId, roleId, req.user?.id);

  res.json(AppResponse.ok(null, result.message));
});

export const detachPolicyFromRole = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const { policyId, roleId } = (req.valid?.params ?? req.params) as {
    policyId: string;
    roleId: string;
  };
  const result = await policiesService.detachPolicyFromRole(
    tenantId,
    policyId,
    roleId,
    req.user?.id,
  );

  res.json(AppResponse.ok(null, result.message));
});

export const getPoliciesForRole = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const roleId = (req.valid?.params?.roleId ?? req.params.roleId) as string;
  const policies = await policiesService.getPoliciesForRole(tenantId, roleId);

  res.json(AppResponse.ok(policies));
});

// ==========================================
// Platform Policy Handlers
// ==========================================

export const listPlatformPolicies = asyncHandler(async (req: Request, res: Response) => {
  const filters = (req.valid?.query ?? req.query) as ListPoliciesQueryDto;
  const result = await policiesService.listPlatformPolicies(filters);

  res.json(
    AppResponse.ok(result.items, 'OK', {
      total: result.total,
      page: result.page,
      limit: result.limit,
    }),
  );
});

export const getPlatformPolicy = asyncHandler(async (req: Request, res: Response) => {
  const policyId = (req.valid?.params?.policyId ?? req.params.policyId) as string;
  const policy = await policiesService.getPlatformPolicyById(policyId);

  res.json(AppResponse.ok(policy));
});

export const createPlatformPolicy = asyncHandler(async (req: Request, res: Response) => {
  const body = (req.valid?.body ?? req.body) as CreatePolicyDto;
  const created = await policiesService.createPlatformPolicy(body, req.staff?.id);

  res.status(201).json(AppResponse.created(created, 'Platform policy created successfully'));
});

export const updatePlatformPolicy = asyncHandler(async (req: Request, res: Response) => {
  const policyId = (req.valid?.params?.policyId ?? req.params.policyId) as string;
  const body = (req.valid?.body ?? req.body) as UpdatePolicyDto;
  const updated = await policiesService.updatePlatformPolicy(policyId, body, req.staff?.id);

  res.json(AppResponse.ok(updated, 'Platform policy updated successfully'));
});

export const deletePlatformPolicy = asyncHandler(async (req: Request, res: Response) => {
  const policyId = (req.valid?.params?.policyId ?? req.params.policyId) as string;
  await policiesService.deletePlatformPolicy(policyId);

  res.json(AppResponse.ok(null, 'Platform policy deleted successfully'));
});

export const attachPolicyToPlatformRole = asyncHandler(async (req: Request, res: Response) => {
  const { policyId, roleId } = (req.valid?.params ?? req.params) as {
    policyId: string;
    roleId: string;
  };
  const result = await policiesService.attachPolicyToPlatformRole(policyId, roleId);

  res.json(AppResponse.ok(null, result.message));
});

export const detachPolicyFromPlatformRole = asyncHandler(async (req: Request, res: Response) => {
  const { policyId, roleId } = (req.valid?.params ?? req.params) as {
    policyId: string;
    roleId: string;
  };
  const result = await policiesService.detachPolicyFromPlatformRole(policyId, roleId);

  res.json(AppResponse.ok(null, result.message));
});

export const getPoliciesForPlatformRole = asyncHandler(async (req: Request, res: Response) => {
  const roleId = (req.valid?.params?.roleId ?? req.params.roleId) as string;
  const policies = await policiesService.getPoliciesForPlatformRole(roleId);

  res.json(AppResponse.ok(policies));
});
