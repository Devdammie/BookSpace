# Schema notes

Multi-tenant BookSpace uses a shared PostgreSQL database with a `departments` row as the tenant.

## Core tables

- `departments` — `id`, unique `slug`, `name`, `timezone`, `pending_expiry_hours`, `is_active`
- `users` — globally unique email, required `department_id`
- `resources` — required `department_id`; child hours/blocks/approvers hang off the resource
- `bookings` — required `department_id`; GiST exclusion `no_overlapping_confirmed` on `(resource_id, blocked_range)` where `status = 'CONFIRMED'`
- `notifications`, `audit_log`, `idempotency_keys` — required `department_id`
- `session` — cookie sessions; payload stores `userId`, `departmentId`, `csrfToken`

## Constraints and indexes

- `no_overlapping_confirmed` — GiST exclusion constraint. Requires `btree_gist`.
- `users_email_lower_idx` — case-insensitive global uniqueness
- `departments_slug_idx` — unique slug
- Department indexes on users, resources, bookings, notifications, audit_log, and idempotency keys
- `idempotency_keys` — one stored response per user and key
- `booking_events` and `audit_log` reject updates and deletes through triggers

## Status values

`PENDING_APPROVAL`, `CONFIRMED`, `REJECTED`, `CANCELLED`, `COMPLETED`, `EXPIRED`.

## Migrations

- `0000_init` — original single-tenant schema
- `0001_multitenant` — adds `departments`, backfills slug `demo`, attaches `department_id`, drops global `settings`
