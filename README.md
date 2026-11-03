# BookSpace

Equipment and room booking for one department. The API is Express, the database is PostgreSQL on Neon through Drizzle, and the interface is a React app.

Docker is not used. The API is written for Neon. This workspace currently uses a local PostgreSQL 17 cluster on port 5433 so the app can run before Neon URLs are added. Replace `DATABASE_URL` and `DATABASE_URL_UNPOOLED` in `.env` with the Neon pooled and direct URLs when you have them.

## Setup

1. Create a Neon project named `bookspace` with a `production` branch and a `staging` branch.
2. Copy `.env.example` to `.env`.
3. Set `DATABASE_URL` to the pooled Neon URL and `DATABASE_URL_UNPOOLED` to the direct URL. Both need `sslmode=require`.
4. Install and prepare the database:

```bash
npm install
& "C:\Program Files\PostgreSQL\17\bin\pg_ctl.exe" -D .pgdata -l .pgdata\server.log -o "-p 5433" start
npm run db:migrate
npm run db:seed
npm run dev
```

The web app is at http://localhost:5173 and the API is at http://localhost:4000.

Demo accounts created by the seed (development only):

| Person | Email | Password |
| --- | --- | --- |
| Admin | ada.admin@bookspace.test | AdminPass!234 |
| Approver | owen.officer@bookspace.test | ApproverPass!234 |
| Lecturer | leah.lecturer@bookspace.test | LecturerPass!234 |
| Student | sam.student@bookspace.test | StudentPass!234 |

New accounts created in the admin screen get a temporary password and must change it at first sign-in. Do not run the demo seed in production unless `ALLOW_DEMO_SEED=yes`.

## Checks

```bash
npm run typecheck
npm test
```

Unit tests always run. API tests against Postgres run only when `DATABASE_URL` is set, so they can use a Neon branch. They are skipped when that variable is absent.

## Production

```bash
npm run build
NODE_ENV=production SERVE_WEB=true npm start
```

Run `npm run db:migrate` with the direct URL before starting the new version. See [docs/operations.md](docs/operations.md).

## Layout

- `apps/web` — React interface
- `apps/api` — HTTP API, Drizzle schema, SQL migrations
- `packages/shared` — booking rules, Zod contracts, timezone helpers
- `docs` — decisions, schema, API, wireframes, operations
