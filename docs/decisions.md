# Decisions locked for BookSpace

These choices follow the SRS baseline with multi-tenant and polish corrections.

- **Tenant** = department. Each department has a unique URL slug (`/o/:slug/...`).
- Departments are created through self-serve signup. The first account becomes the department administrator.
- Membership is one department per person. Email addresses are unique globally.
- Isolation is hard: every authenticated query is scoped by `department_id`. Cross-tenant IDs return 404.
- Users are students, lecturers, and staff. Roles are `member`, `approver`, and `admin`. A person may hold more than one role inside their department.
- After the first admin, accounts are created by a department administrator. Temporary passwords must be changed before other actions.
- Approval is required only when a resource says so. Resources without approval confirm in the same request.
- Equipment is tracked as individual items. Quantity pools are out of scope.
- Several pending requests may target one slot. Only one can become `CONFIRMED`. Pending requests that overlap an already **CONFIRMED** booking (or maintenance block) are rejected at submit. Competing pending requests are rejected when the slot is confirmed.
- Suggestions respect the one-sided end buffer and search nearby windows and days.
- Notifications are in-app rows written in the same transaction as the booking change.
- PostgreSQL is hosted on Neon. The API uses the pooled URL. Migrations use the direct URL.
- Drizzle is the only query layer. The no-overlap rule is a custom SQL migration because Drizzle cannot express an exclusion constraint.
- The runtime driver is `node-postgres`, not Neon's HTTP driver, because confirmation needs a multi-statement transaction and `SELECT … FOR UPDATE`.
- Docker is not part of the current setup. Tests that need Postgres run against `DATABASE_URL` when it is present.
- The minute maintenance job runs catch-up on boot, uses an in-process overlap guard, drains capped batches, and stops cleanly on shutdown.

## Corrections to the source document

- `PENDING_APPROVAL → CONFIRMED` is a real transition. Resources that do not need approval are inserted as `CONFIRMED`.
- A confirmed booking is not edited in place by the requester. They cancel, or an administrator reschedules it inside one transaction.
- Approvers are stored in `resource_approvers` and must belong to the same department as the resource.
- Maintenance blocks are checked inside the same resource-row lock as confirmation. They are not part of the exclusion constraint.
- `audit_log` records non-booking changes and is department-scoped. `booking_events` and `audit_log` reject updates and deletes with a trigger.
- `EXPIRED` and `COMPLETED` are applied by a minute job in the API process.
- Validation failures return 400. Conflicts and illegal transitions return 409. 422 is not used.
- The buffer is added after the requested end only.
