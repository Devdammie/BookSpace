import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, type ReactNode } from 'react';
import { api, ApiError, setCsrf } from './api';

export type CurrentUser = {
  id: string;
  email: string;
  fullName: string;
  userType: 'student' | 'lecturer' | 'staff';
  roles: Array<'member' | 'approver' | 'admin'>;
  mustChangePassword: boolean;
  timezone: string;
};

type AuthState = {
  user: CurrentUser | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['me'],
    retry: false,
    queryFn: async () => {
      try {
        const me = await api<{ data: CurrentUser }>('/api/v1/users/me');
        const csrf = await api<{ data: { csrfToken: string } }>('/api/v1/auth/csrf');
        setCsrf(csrf.data.csrfToken);
        return me.data;
      } catch (error) {
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return null;
        throw error;
      }
    },
  });

  return (
    <AuthContext.Provider
      value={{
        user: query.data ?? null,
        loading: query.isLoading,
        error: query.error instanceof Error ? query.error.message : null,
        refresh: async () => {
          await queryClient.invalidateQueries({ queryKey: ['me'] });
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('AuthProvider is missing');
  return value;
}
