# API

Base path `/api/v1`. Session cookie `bookspace.sid` stores `userId` and `departmentId`. Mutating requests from a signed-in user send `x-csrf-token` from `GET /auth/csrf` or the login response. Errors use a problem JSON body with `status`, `code`, and `detail`. All authenticated data routes are scoped to the session department.

| Method | Path | Access |
| --- | --- | --- |
| POST | /departments | Public. Creates a department and its first admin |
| GET | /departments/:slug | Public. Name, slug, timezone only |
| POST | /auth/login | Public. Body includes `departmentSlug` |
| POST | /auth/logout | Signed in |
| GET | /auth/csrf | Signed in |
| POST | /auth/change-password | Signed in |
| GET | /users/me | Signed in |
| PATCH | /users/me | Signed in |
| GET, POST | /users | Admin |
| PATCH | /users/:id | Admin |
| POST | /users/:id/reset-password | Admin |
| PUT | /users/:id/roles | Admin |
| GET, POST | /resources | List: signed in. Create: admin |
| GET, PATCH | /resources/:id | Read: signed in. Update: admin |
| GET | /resources/:id/availability | Signed in |
| PUT | /resources/:id/hours | Admin |
| POST | /resources/:id/blocks | Admin |
| DELETE | /resources/:id/blocks/:blockId | Admin |
| PUT | /resources/:id/approvers | Admin |
| POST, GET | /bookings | Signed in. `scope=mine`, `queue`, or `all` |
| GET, PATCH | /bookings/:id | Owner or authorized staff. Patch is pending only |
| POST | /bookings/:id/cancel | Owner or admin |
| POST | /bookings/:id/approve | Assigned approver or admin, not the requester |
| POST | /bookings/:id/reject | Assigned approver or admin, not the requester |
| POST | /bookings/:id/reschedule | Admin, confirmed bookings |
| GET | /bookings/:id/events | Owner or authorized staff |
| GET | /approvals | Approver or admin |
| GET | /notifications | Signed in |
| POST | /notifications/:id/read | Owner |
| POST | /notifications/read-all | Owner |
| GET | /dashboard | Signed in |
| GET | /admin/dashboard | Admin |
| GET | /admin/reports/bookings | Approver or admin |
| GET | /admin/reports/bookings.csv | Approver or admin |
| GET | /admin/audit | Admin |
| GET, PATCH | /admin/settings | Admin |
| POST | /internal/maintenance | Cron only. `Authorization: Bearer $CRON_SECRET` |
| GET | /health, /ready | Public, not under `/api/v1` |

`POST /bookings` accepts `Idempotency-Key`. A conflict response may include `suggestions` that respect the resource buffer and nearby opening windows.

On Vercel, public traffic reaches the API through top-level rewrites (`/api/*`, `/health`, `/ready`, `/openapi.yaml`). The SPA stays on the same origin and keeps using relative `/api/v1/...` URLs. There are no service bindings because the browser calls the API directly.
