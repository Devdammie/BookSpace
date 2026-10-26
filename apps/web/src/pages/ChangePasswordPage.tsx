import { passwordSchema } from '@bookspace/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { api, errorText } from '../lib/api';
import { useAuth } from '../lib/auth';

const schema = z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema });

export function ChangePasswordPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { currentPassword: '', newPassword: '' } });
  return (
    <form
      className="panel form"
      onSubmit={form.handleSubmit(async (values) => {
        try {
          await api('/api/v1/auth/change-password', { method: 'POST', body: JSON.stringify(values) });
          await auth.refresh();
          navigate('/');
        } catch (error) {
          form.setError('root', { message: errorText(error) });
        }
      })}
    >
      <h1>Change password</h1>
      <p className="muted">Use a password of at least 10 characters, with a letter and a number.</p>
      <label>
        Current password
        <input type="password" autoComplete="current-password" {...form.register('currentPassword')} />
      </label>
      <label>
        New password
        <input type="password" autoComplete="new-password" {...form.register('newPassword')} />
      </label>
      {form.formState.errors.newPassword && <p className="alert">{form.formState.errors.newPassword.message}</p>}
      {form.formState.errors.root && <p className="alert" role="alert">{form.formState.errors.root.message}</p>}
      <button className="button" type="submit" disabled={form.formState.isSubmitting}>Save password</button>
    </form>
  );
}
