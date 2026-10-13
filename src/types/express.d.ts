import 'express';

export interface AuthenticatedUser {
  id: string;
  role: 'USER' | 'ADMIN' | string;
  status?: string;
}

export interface AuthenticatedTenant {
  id: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'TRIALING' | 'DEACTIVATED';
  plan: string;
}

export interface TenantMembershipContext {
  id: string;
  status: 'ACTIVE' | 'INVITED' | 'SUSPENDED';
  roles: string[];
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
      tenant?: AuthenticatedTenant;
      membership?: TenantMembershipContext;
      permissions?: string[];
      valid?: ValidatedRequestData;
    }
  }
}
