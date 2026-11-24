import { passwordSchema } from '@bookspace/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { api, errorText } from '../lib/api';
import { useAuth } from '../lib/auth';
import { orgPath } from '../lib/paths';

const schema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: 'Passwords must match',
    path: ['confirmPassword'],
  });

export function ChangePasswordPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const { slug = auth.user?.departmentSlug ?? '' } = useParams();
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });
  return (
    <form
      className="panel form"
      onSubmit={form.handleSubmit(async (values) => {
        try {
          await api('/api/v1/auth/change-password', {
            method: 'POST',
            body: JSON.stringify({
              currentPassword: values.currentPassword,
              newPassword: values.newPassword,
            }),
          });
          await auth.refresh();
          navigate(orgPath(slug));
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
      <label>
        Confirm new password
        <input type="password" autoComplete="new-password" {...form.register('confirmPassword')} />
      </label>
      {form.formState.errors.newPassword && <p className="alert">{form.formState.errors.newPassword.message}</p>}
      {form.formState.errors.confirmPassword && (
        <p className="alert">{form.formState.errors.confirmPassword.message}</p>
      )}
      {form.formState.errors.root && (
        <p className="alert" role="alert">
          {form.formState.errors.root.message}
        </p>
      )}
      <div className="inline">
        <button className="button" type="submit" disabled={form.formState.isSubmitting}>
          Save password
        </button>
        <button
          className="button secondary"
          type="button"
          onClick={async () => {
            await api('/api/v1/auth/logout', { method: 'POST' });
            await auth.refresh();
            navigate(orgPath(slug, '/login'));
          }}
        >
          Sign out
        </button>
      </div>
    </form>
  );
}
