import 'express';

export interface AuthenticatedUser {
  id: string;
  role: 'USER' | 'ADMIN' | string;
  status?: string;
}

export interface AuthenticatedStaff {
  id: string;
  email: string;
  displayName?: string;
  roleId: string;
  roleKey: string;
  permissions: string[];
}

export interface AuthenticatedTenant {
  id: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'TRIALING' | 'DEACTIVATED';
  plan: string;
  databaseMode?: 'shared' | 'dedicated';
}

export interface TenantMembershipContext {
  id: string;
  status: 'ACTIVE' | 'INVITED' | 'SUSPENDED';
  roles: string[];
}

export interface PlatformSupportSessionContext {
  sessionId: string;
  staffId: string;
  tenantId: string;
  reason: string;
  expiresAt: Date;
}

export interface ImpersonatorContext {
  userId: string;
  role: string;
  reason: string;
  sessionId: string;
}

export interface ValidatedRequestData {
  body?: any;
  query?: any;
  params?: any;
}

declare global {
  namespace Express {
    interface Request {
      id?: string;
      user?: AuthenticatedUser;
      staff?: AuthenticatedStaff;
      supportSession?: PlatformSupportSessionContext;
      impersonator?: ImpersonatorContext;
      isImpersonated?: boolean;
      tenant?: AuthenticatedTenant;
      membership?: TenantMembershipContext;
      permissions?: string[];
      valid?: ValidatedRequestData;
    }
  }
}
