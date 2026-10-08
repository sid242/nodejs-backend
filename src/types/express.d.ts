import 'express';

export interface AuthenticatedUser {
  id: string;
  role: 'USER' | 'ADMIN' | string;
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
      valid?: ValidatedRequestData;
    }
  }
}
