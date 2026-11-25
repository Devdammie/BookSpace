# Operations

## Environments

Use one Neon project and separate branches for `staging` and `production`. Each branch has its own pooled URL and direct URL. Do not point two environments at the same branch.

Migrations:

```bash
npm run db:migrate
```

The command refuses a host that contains `-pooler`, because migration locks need a direct connection. Enable `btree_gist` is included in the migration (`CREATE EXTENSION`). Confirm the extension is allowed on the Neon project before the first migrate.

The API process does not migrate on startup.

## Vercel (recommended multi-service)

The repo root [`vercel.json`](../vercel.json) defines two services:

| Service | Root | Public paths |
| --- | --- | --- |
| `api` | `apps/api` | `/api/*`, `/health`, `/ready`, `/openapi.yaml` |
| `web` | `apps/web` | everything else (`/(.*)`) |

No service bindings: the browser talks to the API on the same domain via relative `/api/v1/...` URLs.

### Project setup

1. Import the GitHub repo into Vercel with **root directory = repository root** (where `vercel.json` lives).
2. Set environment variables for Production (and Preview if used):

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | Neon pooled URL, `sslmode=require` |
| `DATABASE_URL_UNPOOLED` | Neon direct URL (migrations) |
| `SESSION_SECRET` | ≥16 random characters |
| `WEB_ORIGIN` | Exact site origin, e.g. `https://your-app.vercel.app` |
| `CRON_SECRET` | Random secret; Vercel Cron sends `Authorization: Bearer …` |
| `SERVE_WEB` | `false` |
| `DEPARTMENT_TIMEZONE` | Optional, default `America/Los_Angeles` |

3. Deploy with Git push or `npx vercel --prod`.
4. Run `npm run db:migrate` against Neon before first traffic.
5. Confirm `/health`, `/`, `/signup`, and a booking flow.

### Maintenance cron

`vercel.json` schedules `POST /api/v1/internal/maintenance` every minute. That route drains expiry/completion batches. Minute crons require a Vercel plan that allows them (Pro+). On Hobby, change the schedule to daily/hourly or run maintenance elsewhere.

In-process `node-cron` is **disabled** when `VERCEL=1`. Local and Render still use the in-process scheduler unless `ENABLE_IN_PROCESS_SCHEDULER=false`.

### Local multi-service

```bash
npx vercel dev
```

## Render (single process)

- Build: `npm install && npm run build`
- Start: `npm start`
- Env: `SERVE_WEB=true`, plus the same database/session variables as above
- Clear the build cache once if install looks stale after dependency moves

## Release checklist

- `npm run typecheck` and `npm test` are green. Set `DATABASE_URL` to the staging branch for the API tests.
- Apply migrations to staging with the direct URL, then to production.
- Set `SESSION_SECRET`, `WEB_ORIGIN`, `DATABASE_URL` (pooled, `sslmode=require`), `DATABASE_URL_UNPOOLED`, and `NODE_ENV=production`.
- On Vercel set `SERVE_WEB=false` and `CRON_SECRET`. On Render set `SERVE_WEB=true`.
- `GET /health` returns ok. `GET /ready` checks the database.
- Sign in as an administrator that was created with a temporary password, not the demo seed.
- Book the same slot twice on staging and confirm one request wins.

## Backups and restore

Neon point-in-time restore is the primary path: create a branch from an earlier timestamp, compare booking and resource counts, then discard the branch.

`node scripts/restore-drill.mjs` prints that procedure. It runs `pg_dump` only when `CONFIRM_RESTORE_DRILL=yes` and `DATABASE_URL_UNPOOLED` is a direct URL with `sslmode=require`. A pooled URL is rejected. The dump file is written to a temp directory and is not restored automatically.

## Rollback

Application rollback is redeploying the previous build. Database migrations are forward-only. If a migration must be undone, restore a Neon branch from the timestamp before the migration and point the app back at it. Do not edit a migration that has already been applied.

## Monitoring

API logs are JSON from pino and include a request id. They do not include cookies or passwords. Watch `maintenance job failed` log lines, cron `401`/`503` on `/api/v1/internal/maintenance`, and HTTP 409/500 rates. Neon's free compute sleeps when idle, so the first request after idle is slower.

## Ongoing

Review role assignments in the audit log, keep dependencies updated, and add regression tests when booking policy changes.
