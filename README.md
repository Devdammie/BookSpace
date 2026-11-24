# BookSpace

Multi-tenant equipment and room booking for university departments. The API is Express, the database is PostgreSQL on Neon through Drizzle, and the interface is a React app.

Each department has its own workspace at `/o/:slug/...`. Anyone can create a department at `/signup` and become its first administrator. Isolation is hard: data never crosses department boundaries.

Docker is not used. The API is written for Neon. This workspace can use a local PostgreSQL 17 cluster on port 5433 before Neon URLs are added. Replace `DATABASE_URL` and `DATABASE_URL_UNPOOLED` in `.env` with the Neon pooled and direct URLs when you have them.

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

Open http://localhost:5173/o/demo/login for the seeded demo department.

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

## Production / Render

Build and start (single service serving API + built web):

```bash
npm install
npm run build
NODE_ENV=production SERVE_WEB=true npm start
```

On Render use:

- **Build command:** `npm install && npm run build`
- **Start command:** `npm start`
- **Env:** `NODE_ENV=production`, `SERVE_WEB=true`, `DATABASE_URL` (pooled), `DATABASE_URL_UNPOOLED` (direct), `SESSION_SECRET`, `WEB_ORIGIN` (your Render URL)

Run `npm run db:migrate` with the direct URL before the first start (or from a one-off job). See [docs/operations.md](docs/operations.md).

Vite/TypeScript live in `@bookspace/web` dependencies so production installs still have them for `npm run build`. The API start script uses `tsx`, also kept as a production dependency.

## Layout

- `apps/web` — React interface (`/` landing, `/signup`, `/o/:slug/...`)
- `apps/api` — HTTP API, Drizzle schema, SQL migrations
- `packages/shared` — booking rules, Zod contracts, timezone helpers
- `docs` — decisions, schema, API, wireframes, operations
