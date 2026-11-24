CREATE TABLE departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL,
  timezone text NOT NULL DEFAULT 'America/Los_Angeles',
  pending_expiry_hours integer NOT NULL DEFAULT 48,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT departments_slug_format CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CONSTRAINT departments_pending_expiry CHECK (pending_expiry_hours BETWEEN 1 AND 168)
);
--> statement-breakpoint
CREATE UNIQUE INDEX departments_slug_idx ON departments (slug);
--> statement-breakpoint
INSERT INTO departments (id, name, slug, timezone, pending_expiry_hours)
SELECT
  gen_random_uuid(),
  'Demo Department',
  'demo',
  coalesce(
    (SELECT value #>> '{}' FROM settings WHERE key = 'timezone' AND jsonb_typeof(value) = 'string'),
    'America/Los_Angeles'
  ),
  coalesce(
    (SELECT (value #>> '{}')::int FROM settings WHERE key = 'pending_expiry_hours' AND jsonb_typeof(value) = 'number'),
    48
  )
WHERE NOT EXISTS (SELECT 1 FROM departments WHERE slug = 'demo');
--> statement-breakpoint
ALTER TABLE users ADD COLUMN department_id uuid REFERENCES departments (id);
--> statement-breakpoint
UPDATE users SET department_id = (SELECT id FROM departments WHERE slug = 'demo' LIMIT 1) WHERE department_id IS NULL;
--> statement-breakpoint
ALTER TABLE users ALTER COLUMN department_id SET NOT NULL;
--> statement-breakpoint
CREATE INDEX users_department_idx ON users (department_id);
--> statement-breakpoint
ALTER TABLE resources ADD COLUMN department_id uuid REFERENCES departments (id);
--> statement-breakpoint
UPDATE resources SET department_id = (SELECT id FROM departments WHERE slug = 'demo' LIMIT 1) WHERE department_id IS NULL;
--> statement-breakpoint
ALTER TABLE resources ALTER COLUMN department_id SET NOT NULL;
--> statement-breakpoint
CREATE INDEX resources_department_idx ON resources (department_id);
--> statement-breakpoint
ALTER TABLE bookings ADD COLUMN department_id uuid REFERENCES departments (id);
--> statement-breakpoint
UPDATE bookings SET department_id = (SELECT id FROM departments WHERE slug = 'demo' LIMIT 1) WHERE department_id IS NULL;
--> statement-breakpoint
ALTER TABLE bookings ALTER COLUMN department_id SET NOT NULL;
--> statement-breakpoint
CREATE INDEX bookings_department_idx ON bookings (department_id);
--> statement-breakpoint
ALTER TABLE notifications ADD COLUMN department_id uuid REFERENCES departments (id);
--> statement-breakpoint
UPDATE notifications SET department_id = (SELECT id FROM departments WHERE slug = 'demo' LIMIT 1) WHERE department_id IS NULL;
--> statement-breakpoint
ALTER TABLE notifications ALTER COLUMN department_id SET NOT NULL;
--> statement-breakpoint
CREATE INDEX notifications_department_idx ON notifications (department_id);
--> statement-breakpoint
ALTER TABLE audit_log ADD COLUMN department_id uuid REFERENCES departments (id);
--> statement-breakpoint
ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only;
--> statement-breakpoint
UPDATE audit_log SET department_id = (SELECT id FROM departments WHERE slug = 'demo' LIMIT 1) WHERE department_id IS NULL;
--> statement-breakpoint
ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only;
--> statement-breakpoint
ALTER TABLE audit_log ALTER COLUMN department_id SET NOT NULL;
--> statement-breakpoint
CREATE INDEX audit_log_department_idx ON audit_log (department_id);
--> statement-breakpoint
ALTER TABLE idempotency_keys ADD COLUMN department_id uuid REFERENCES departments (id);
--> statement-breakpoint
UPDATE idempotency_keys SET department_id = (SELECT id FROM departments WHERE slug = 'demo' LIMIT 1) WHERE department_id IS NULL;
--> statement-breakpoint
ALTER TABLE idempotency_keys ALTER COLUMN department_id SET NOT NULL;
--> statement-breakpoint
CREATE INDEX idempotency_keys_department_idx ON idempotency_keys (department_id);
--> statement-breakpoint
DROP TABLE IF EXISTS settings;
