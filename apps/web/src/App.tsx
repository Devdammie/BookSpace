import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { Layout } from './components/Layout';
import { AuthProvider, useAuth } from './lib/auth';
import { orgPath } from './lib/paths';
import { AdminPage } from './pages/AdminPage';
import { ApprovalsPage } from './pages/ApprovalsPage';
import { BookingDetailPage } from './pages/BookingDetailPage';
import { BookingsPage } from './pages/BookingsPage';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { DashboardPage } from './pages/DashboardPage';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { ResourceDetailPage } from './pages/ResourceDetailPage';
import { ResourcesPage } from './pages/ResourcesPage';
import { SignupPage } from './pages/SignupPage';

function RequireAuth() {
  const auth = useAuth();
  const location = useLocation();
  const { slug = '' } = useParams();
  if (auth.loading) return <p className="status-line">Checking your session…</p>;
  if (!auth.user) {
    return <Navigate to={orgPath(slug, '/login')} replace state={{ from: location.pathname }} />;
  }
  if (auth.user.departmentSlug !== slug) {
    return <Navigate to={orgPath(auth.user.departmentSlug)} replace />;
  }
  if (auth.user.mustChangePassword && !location.pathname.endsWith('/change-password')) {
    return <Navigate to={orgPath(slug, '/change-password')} replace />;
  }
  return <Layout />;
}

function LegacyRedirect({ to }: { to: string }) {
  const auth = useAuth();
  if (auth.loading) return <p className="status-line">Checking your session…</p>;
  if (auth.user) {
    const path = to === '/login' ? '' : to;
    return <Navigate to={orgPath(auth.user.departmentSlug, path)} replace />;
  }
  if (to === '/login') return <Navigate to="/o/demo/login" replace />;
  return <Navigate to="/" replace />;
}

export function App() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } }));
  return (
    <QueryClientProvider client={client}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/o/:slug/login" element={<LoginPage />} />
            <Route path="/o/:slug" element={<RequireAuth />}>
              <Route index element={<DashboardPage />} />
              <Route path="resources" element={<ResourcesPage />} />
              <Route path="resources/:id" element={<ResourceDetailPage />} />
              <Route path="bookings" element={<BookingsPage />} />
              <Route path="bookings/:id" element={<BookingDetailPage />} />
              <Route path="approvals" element={<ApprovalsPage />} />
              <Route path="notifications" element={<NotificationsPage />} />
              <Route path="admin" element={<AdminPage />} />
              <Route path="change-password" element={<ChangePasswordPage />} />
            </Route>
            <Route path="/login" element={<LegacyRedirect to="/login" />} />
            <Route path="/resources" element={<LegacyRedirect to="/resources" />} />
            <Route path="/bookings" element={<LegacyRedirect to="/bookings" />} />
            <Route path="/admin" element={<LegacyRedirect to="/admin" />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
