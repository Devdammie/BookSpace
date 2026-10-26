const TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
};

export class ProblemError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string;
  readonly extras: Record<string, unknown>;

  constructor(status: number, code: string, detail: string, extras: Record<string, unknown> = {}) {
    super(detail);
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.extras = extras;
  }

  toJSON(instance?: string) {
    return {
      type: 'about:blank',
      title: TITLES[this.status] ?? 'Error',
      status: this.status,
      code: this.code,
      detail: this.detail,
      ...(instance ? { instance } : {}),
      ...this.extras,
    };
  }
}

export function pgCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current && typeof current === 'object'; depth += 1) {
    if ('code' in current && typeof current.code === 'string') return current.code;
    current = 'cause' in current ? current.cause : undefined;
  }
  return undefined;
}

export function isSlotConflict(error: unknown): boolean {
  return pgCode(error) === '23P01';
}
