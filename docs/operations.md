# Operations

## Environments

Use one Neon project and separate branches for `staging` and `production`. Each branch has its own pooled URL and direct URL. Do not point two environments at the same branch.

Migrations:

```bash
npm run db:migrate
```

The command refuses a host that contains `-pooler`, because migration locks need a direct connection. Enable `btree_gist` is included in the migration (`CREATE EXTENSION`). Confirm the extension is allowed on the Neon project before the first migrate.

The API process does not migrate on startup.

## Release checklist

- `npm run typecheck` and `npm test` are green. Set `DATABASE_URL` to the staging branch for the API tests.
- Apply migrations to staging with the direct URL, then to production.
- Set `SESSION_SECRET`, `WEB_ORIGIN`, `DATABASE_URL` (pooled, `sslmode=require`), and `NODE_ENV=production`.
- Build the web app and start the API with `SERVE_WEB=true`, or host the static files behind the same origin so the session cookie is first-party.
- `GET /health` returns ok. `GET /ready` checks the database.
- Sign in as an administrator that was created with a temporary password, not the demo seed.
- Book the same slot twice on staging and confirm one request wins.

## Backups and restore

Neon point-in-time restore is the primary path: create a branch from an earlier timestamp, compare booking and resource counts, then discard the branch.

`node scripts/restore-drill.mjs` prints that procedure. It runs `pg_dump` only when `CONFIRM_RESTORE_DRILL=yes` and `DATABASE_URL_UNPOOLED` is a direct URL with `sslmode=require`. A pooled URL is rejected. The dump file is written to a temp directory and is not restored automatically.

## Rollback

Application rollback is redeploying the previous build. Database migrations are forward-only. If a migration must be undone, restore a Neon branch from the timestamp before the migration and point the app back at it. Do not edit a migration that has already been applied.

## Monitoring

API logs are JSON from pino and include a request id. They do not include cookies or passwords. Watch `maintenance job failed` log lines and HTTP 409/500 rates. The expiry job runs only while the API process is running. Neon's free compute sleeps when idle, so the first request after idle is slower and expiry does not run during sleep.

## Ongoing

Review role assignments in the audit log, keep dependencies updated, and add regression tests when booking policy changes.
