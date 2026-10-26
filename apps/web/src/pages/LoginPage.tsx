import { loginSchema } from '@bookspace/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Navigate, useNavigate } from 'react-router-dom';
import { api, errorText, setCsrf } from '../lib/api';
import { useAuth } from '../lib/auth';

export function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const form = useForm({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });
  if (auth.user && !auth.user.mustChangePassword) return <Navigate to="/" replace />;
  if (auth.user?.mustChangePassword) return <Navigate to="/change-password" replace />;
  return (
    <div className="login-screen">
      <form
        className="card login-card"
        onSubmit={form.handleSubmit(async (values) => {
          try {
            const result = await api<{ data: { csrfToken: string } }>('/api/v1/auth/login', {
              method: 'POST',
              body: JSON.stringify(values),
            });
            setCsrf(result.data.csrfToken);
            await auth.refresh();
            navigate('/');
          } catch (error) {
            form.setError('root', { message: errorText(error) });
          }
        })}
      >
        <div className="brand">
          <h1>BookSpace</h1>
          <p className="muted">Sign in to reserve a room or a piece of equipment.</p>
        </div>
        <label>
          Email
          <input type="email" autoComplete="username" {...form.register('email')} />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" {...form.register('password')} />
        </label>
        {form.formState.errors.root && <p className="alert" role="alert">{form.formState.errors.root.message}</p>}
        <button className="button" type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
