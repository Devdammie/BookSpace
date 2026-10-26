# Acceptance mapping

| Criterion | Where it is enforced |
| --- | --- |
| 1. Anonymous callers cannot use booking or dashboard routes | `requireAuth`; API test `AC1` when `DATABASE_URL` is set |
| 2. Overlapping confirmed bookings are rejected | Exclusion constraint `no_overlapping_confirmed`; API test `AC2` |
| 3. Concurrent requests cannot double-book | Same constraint inside a transaction; API test `AC3` |
| 4. Only an assigned approver or admin can decide, and not their own request | `canDecide`; API test `AC4` |
| 5. Cancelled or rejected requests cannot be approved | `transition`; API test `AC5` |
| 6. Maintenance blocks prevent a reservation | Block check inside the resource lock; `RESOURCE_BLOCKED` |
| 7. Changes are auditable | `booking_events` and `audit_log`, both append-only |
| 8. Backup restore is documented and guarded | `docs/operations.md`, `scripts/restore-drill.mjs`, `scripts/restore-target.test.mjs` |
| 9. Tests run before release | `.github/workflows/ci.yml` runs typecheck and unit tests. API tests run in CI when the Neon secrets are configured |

Unit tests cover overlap, the one-sided buffer, the state machine, self-approval, opening hours, DST conversion, free-slot suggestions, and utilization. They do not need a database.
