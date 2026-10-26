export class ApiError extends Error {
  status: number;
  code: string;
  detail: string;
  suggestions?: { startTime: string; endTime: string }[];
  issues?: { path: string; message: string }[];

  constructor(body: Record<string, unknown>, status: number) {
    super(typeof body.detail === 'string' ? body.detail : 'Request failed');
    this.status = status;
    this.code = typeof body.code === 'string' ? body.code : 'ERROR';
    this.detail = this.message;
    this.suggestions = Array.isArray(body.suggestions) ? (body.suggestions as ApiError['suggestions']) : undefined;
    this.issues = Array.isArray(body.issues) ? (body.issues as ApiError['issues']) : undefined;
  }
}

let csrfToken = '';

export function setCsrf(token: string) {
  csrfToken = token;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const method = (init.method ?? 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && csrfToken) headers.set('x-csrf-token', csrfToken);
  let response: Response;
  try {
    response = await fetch(path.startsWith('/') ? path : `/api/v1${path}`, {
      ...init,
      headers,
      credentials: 'include',
    });
  } catch {
    throw new ApiError({ code: 'NETWORK', detail: 'The booking service is not reachable.' }, 0);
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!response.ok) throw new ApiError(body, response.status);
  return body as T;
}

export function errorText(error: unknown) {
  if (error instanceof ApiError) return error.detail;
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}
