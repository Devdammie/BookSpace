# Schema

Applied by `apps/api/drizzle/0000_init.sql`. The Drizzle definitions in `apps/api/src/db/schema.ts` match these tables.

- `users`, `roles`, `user_roles` — identity and RBAC. Email uniqueness is `lower(email)`.
- `resources` — rooms and equipment, soft status (`active`, `maintenance`, `retired`), duration limits, buffer, optional parent resource, allowed user types.
- `resource_hours` — local opening windows, weekday 0–6.
- `resource_blocks` — maintenance and closures.
- `resource_approvers` — who may decide requests for a resource.
- `bookings` — requester, resource, start, end, `blocked_range` (`tstzrange`, half-open, end includes the buffer), status, purpose, optimistic `version`.
- `no_overlapping_confirmed` — GiST exclusion constraint on `(resource_id, blocked_range)` where `status = 'CONFIRMED'`. Requires `btree_gist`.
- `approvals`, `booking_events` — decision record and append-only history.
- `audit_log` — append-only record of account, resource, settings, and override actions.
- `notifications` — in-app outbox.
- `idempotency_keys` — one stored response per user and key.
- `settings` — `timezone` and `pending_expiry_hours`.
- `session` — server-side sessions for `connect-pg-simple`.

Status values: `PENDING_APPROVAL`, `CONFIRMED`, `REJECTED`, `CANCELLED`, `COMPLETED`, `EXPIRED`.
