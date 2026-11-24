import { loginSchema } from '@bookspace/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, errorText, setCsrf } from '../lib/api';
import { useAuth } from '../lib/auth';
import { orgPath } from '../lib/paths';

export function LoginPage() {
  const { slug = '' } = useParams();
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string; message?: string } | null)?.from;
  const notice = (location.state as { message?: string } | null)?.message;
  const department = useQuery({
    queryKey: ['department', slug],
    enabled: Boolean(slug),
    queryFn: () => api<{ data: { name: string; slug: string } }>(`/api/v1/departments/${slug}`),
  });
  const form = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '', departmentSlug: slug },
  });

  if (auth.user && !auth.user.mustChangePassword) {
    return <Navigate to={orgPath(auth.user.departmentSlug)} replace />;
  }
  if (auth.user?.mustChangePassword) {
    return <Navigate to={orgPath(auth.user.departmentSlug, '/change-password')} replace />;
  }

  return (
    <div className="login-screen">
      <form
        className="card login-card"
        onSubmit={form.handleSubmit(async (values) => {
          try {
            const result = await api<{ data: { csrfToken: string; user: { departmentSlug: string } } }>(
              '/api/v1/auth/login',
              {
                method: 'POST',
                body: JSON.stringify({ ...values, departmentSlug: slug }),
              },
            );
            setCsrf(result.data.csrfToken);
            await auth.refresh();
            const destination =
              from && from.startsWith(orgPath(slug)) ? from : orgPath(result.data.user.departmentSlug);
            navigate(destination);
          } catch (error) {
            form.setError('root', { message: errorText(error) });
          }
        })}
      >
        <div className="brand">
          <h1>BookSpace</h1>
          <p className="muted">
            {department.data?.data.name
              ? `Sign in to ${department.data.data.name}.`
              : 'Sign in to reserve a room or a piece of equipment.'}
          </p>
        </div>
        <p className="muted">Accounts are created by a department administrator. Ask yours for an invite if you do not have one.</p>
        {notice && (
          <p className="alert" role="status">
            {notice}
          </p>
        )}
        {department.isError && (
          <p className="alert" role="alert">
            That department was not found.
          </p>
        )}
        <label>
          Email
          <input type="email" autoComplete="username" {...form.register('email')} />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" {...form.register('password')} />
        </label>
        {form.formState.errors.root && (
          <p className="alert" role="alert">
            {form.formState.errors.root.message}
          </p>
        )}
        <button className="button" type="submit" disabled={form.formState.isSubmitting || department.isError}>
          {form.formState.isSubmitting ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="muted">
          <Link to="/signup">Create a department</Link> · <Link to="/">Home</Link>
        </p>
      </form>
    </div>
  );
}
