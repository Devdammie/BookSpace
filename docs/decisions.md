# Decisions locked for the MVP

These choices follow the SRS recommended baseline, with the corrections found in review.

- One department. Timezone defaults to `America/Los_Angeles` and can be changed by an administrator.
- Users are students, lecturers, and staff. Roles are `member`, `approver`, and `admin`. A person may hold more than one role.
- Accounts are created by an administrator. The temporary password is shown once and must be changed before any other action.
- Approval is required only when a resource says so. Resources without approval confirm in the same request.
- Equipment is tracked as individual items. Quantity pools are out of scope.
- Several pending requests may target one slot. Only one can become `CONFIRMED`. The database exclusion constraint is the final guard. Competing pending requests are rejected when the slot is confirmed.
- Notifications are in-app rows written in the same transaction as the booking change.
- PostgreSQL is hosted on Neon. The API uses the pooled URL. Migrations use the direct URL.
- Drizzle is the only query layer. The no-overlap rule is a custom SQL migration because Drizzle cannot express an exclusion constraint.
- The runtime driver is `node-postgres`, not Neon's HTTP driver, because confirmation needs a multi-statement transaction and `SELECT … FOR UPDATE`.
- Docker is not part of the current setup. Tests that need Postgres run against `DATABASE_URL` when it is present.

## Corrections to the source document

- `PENDING_APPROVAL → CONFIRMED` is a real transition. Resources that do not need approval are inserted as `CONFIRMED`.
- A confirmed booking is not edited in place by the requester. They cancel, or an administrator reschedules it inside one transaction.
- Approvers are stored in `resource_approvers`.
- Maintenance blocks are checked inside the same resource-row lock as confirmation. They are not part of the exclusion constraint.
- `audit_log` records non-booking changes. `booking_events` and `audit_log` reject updates and deletes with a trigger.
- `EXPIRED` and `COMPLETED` are applied by a minute job in the API process.
- Validation failures return 400. Conflicts and illegal transitions return 409. 422 is not used.
- The buffer is added after the requested end only.
