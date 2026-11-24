import type { BookingStatus } from '@bookspace/shared';

export type Actor = {
  id: string;
  departmentId: string;
  departmentSlug: string;
  email: string;
  fullName: string;
  userType: 'student' | 'lecturer' | 'staff';
  roles: Array<'member' | 'approver' | 'admin'>;
  mustChangePassword: boolean;
  isActive: boolean;
};

export type Tenant = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  pendingExpiryHours: number;
  isActive: boolean;
};

export type BookingDto = {
  id: string;
  resourceId: string;
  resourceName: string;
  userId: string;
  requesterName: string;
  startTime: string;
  endTime: string;
  status: BookingStatus;
  purpose: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  message?: string;
};

declare global {
  namespace Express {
    interface Request {
      actor?: Actor;
      tenant?: Tenant;
    }
  }
}

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    departmentId?: string;
    csrfToken?: string;
  }
}

export {};
