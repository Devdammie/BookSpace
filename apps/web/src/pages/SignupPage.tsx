import { createDepartmentSchema, isValidTimeZone } from '@bookspace/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { api, errorText } from '../lib/api';
import { orgPath } from '../lib/paths';

const formSchema = createDepartmentSchema.extend({
  confirmPassword: z.string().min(1),
}).refine((value) => value.adminPassword === value.confirmPassword, {
  message: 'Passwords must match',
  path: ['confirmPassword'],
});

export function SignupPage() {
  const navigate = useNavigate();
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      slug: '',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles',
      adminFullName: '',
      adminEmail: '',
      adminPassword: '',
      confirmPassword: '',
    },
  });

  return (
    <div className="login-screen">
      <form
        className="card login-card form"
        onSubmit={form.handleSubmit(async (values) => {
          try {
            if (!isValidTimeZone(values.timezone)) {
              form.setError('timezone', { message: 'Unknown timezone' });
              return;
            }
            const { confirmPassword: _confirm, ...body } = values;
            const result = await api<{ data: { slug: string } }>('/api/v1/departments', {
              method: 'POST',
              body: JSON.stringify(body),
            });
            navigate(orgPath(result.data.slug, '/login'), {
              state: { message: 'Department created. Sign in with your admin account.' },
            });
          } catch (error) {
            form.setError('root', { message: errorText(error) });
          }
        })}
      >
        <div className="brand">
          <h1>Create a department</h1>
          <p className="muted">You become the first administrator for this workspace.</p>
        </div>
        <label>
          Department name
          <input {...form.register('name')} />
        </label>
        <label>
          URL slug
          <input placeholder="cs-lab" {...form.register('slug')} />
        </label>
        <p className="muted">Members will sign in at /o/{form.watch('slug') || 'your-slug'}/login</p>
        <label>
          Timezone
          <input {...form.register('timezone')} />
        </label>
        <label>
          Your name
          <input {...form.register('adminFullName')} />
        </label>
        <label>
          Work email
          <input type="email" autoComplete="username" {...form.register('adminEmail')} />
        </label>
        <label>
          Password
          <input type="password" autoComplete="new-password" {...form.register('adminPassword')} />
        </label>
        <label>
          Confirm password
          <input type="password" autoComplete="new-password" {...form.register('confirmPassword')} />
        </label>
        {form.formState.errors.confirmPassword && (
          <p className="alert">{form.formState.errors.confirmPassword.message}</p>
        )}
        {form.formState.errors.root && (
          <p className="alert" role="alert">
            {form.formState.errors.root.message}
          </p>
        )}
        <button className="button" type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Creating…' : 'Create department'}
        </button>
        <p className="muted">
          <Link to="/">Back</Link>
        </p>
      </form>
    </div>
  );
}
