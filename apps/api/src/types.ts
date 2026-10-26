import type { BookingStatus } from '@bookspace/shared';

export type Actor = {
  id: string;
  email: string;
  fullName: string;
  userType: 'student' | 'lecturer' | 'staff';
  roles: Array<'member' | 'approver' | 'admin'>;
  mustChangePassword: boolean;
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
    }
  }
}

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    csrfToken?: string;
  }
}

export {};
