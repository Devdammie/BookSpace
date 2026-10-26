CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
CREATE TYPE user_type AS ENUM ('student', 'lecturer', 'staff');
--> statement-breakpoint
CREATE TYPE resource_kind AS ENUM ('room', 'equipment');
--> statement-breakpoint
CREATE TYPE resource_status AS ENUM ('active', 'maintenance', 'retired');
--> statement-breakpoint
CREATE TYPE booking_status AS ENUM (
  'PENDING_APPROVAL',
  'CONFIRMED',
  'REJECTED',
  'CANCELLED',
  'COMPLETED',
  'EXPIRED'
);
--> statement-breakpoint
CREATE TYPE approval_decision AS ENUM ('approved', 'rejected');
--> statement-breakpoint
CREATE TABLE roles (
  id text PRIMARY KEY,
  description text NOT NULL
);
--> statement-breakpoint
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  password_hash text NOT NULL,
  full_name text NOT NULL,
  user_type user_type NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  must_change_password boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email));
--> statement-breakpoint
CREATE TABLE user_roles (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  role_id text NOT NULL REFERENCES roles (id) ON DELETE RESTRICT,
  PRIMARY KEY (user_id, role_id)
);
--> statement-breakpoint
CREATE TABLE resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind resource_kind NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  location text NOT NULL,
  capacity integer NOT NULL,
  status resource_status NOT NULL DEFAULT 'active',
  approval_required boolean NOT NULL DEFAULT false,
  min_minutes integer NOT NULL,
  max_minutes integer NOT NULL,
  max_advance_days integer NOT NULL,
  buffer_minutes integer NOT NULL DEFAULT 0,
  asset_tag text,
  serial_no text,
  parent_resource_id uuid REFERENCES resources (id) ON DELETE SET NULL,
  allowed_user_types text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT resources_capacity_positive CHECK (capacity > 0),
  CONSTRAINT resources_duration_positive CHECK (min_minutes > 0 AND max_minutes >= min_minutes),
  CONSTRAINT resources_advance_nonnegative CHECK (max_advance_days >= 0),
  CONSTRAINT resources_buffer_nonnegative CHECK (buffer_minutes >= 0)
);
--> statement-breakpoint
CREATE TABLE resource_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id uuid NOT NULL REFERENCES resources (id) ON DELETE RESTRICT,
  weekday smallint NOT NULL,
  open_time time NOT NULL,
  close_time time NOT NULL,
  CONSTRAINT resource_hours_weekday CHECK (weekday BETWEEN 0 AND 6),
  CONSTRAINT resource_hours_order CHECK (close_time > open_time)
);
--> statement-breakpoint
CREATE INDEX resource_hours_resource_idx ON resource_hours (resource_id);
--> statement-breakpoint
CREATE TABLE resource_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id uuid NOT NULL REFERENCES resources (id) ON DELETE RESTRICT,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT resource_blocks_order CHECK (end_time > start_time)
);
--> statement-breakpoint
CREATE INDEX resource_blocks_resource_idx ON resource_blocks (resource_id, start_time);
--> statement-breakpoint
CREATE TABLE resource_approvers (
  resource_id uuid NOT NULL REFERENCES resources (id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  PRIMARY KEY (resource_id, user_id)
);
--> statement-breakpoint
CREATE INDEX resource_approvers_user_idx ON resource_approvers (user_id);
--> statement-breakpoint
CREATE TABLE bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  resource_id uuid NOT NULL REFERENCES resources (id) ON DELETE RESTRICT,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  blocked_range tstzrange NOT NULL,
  status booking_status NOT NULL,
  purpose text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bookings_time_order CHECK (end_time > start_time),
  CONSTRAINT bookings_version_positive CHECK (version > 0)
);
--> statement-breakpoint
CREATE INDEX bookings_resource_start_idx ON bookings (resource_id, start_time);
--> statement-breakpoint
CREATE INDEX bookings_user_start_idx ON bookings (user_id, start_time DESC);
--> statement-breakpoint
CREATE INDEX bookings_pending_idx ON bookings (resource_id) WHERE status = 'PENDING_APPROVAL';
--> statement-breakpoint
ALTER TABLE bookings
  ADD CONSTRAINT no_overlapping_confirmed
  EXCLUDE USING gist (resource_id WITH =, blocked_range WITH &&)
  WHERE (status = 'CONFIRMED');
--> statement-breakpoint
CREATE TABLE approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings (id) ON DELETE RESTRICT,
  approver_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  decision approval_decision NOT NULL,
  reason text NOT NULL DEFAULT '',
  decided_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX approvals_booking_idx ON approvals (booking_id);
--> statement-breakpoint
CREATE TABLE booking_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings (id) ON DELETE RESTRICT,
  actor_id uuid REFERENCES users (id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  from_status booking_status,
  to_status booking_status,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX booking_events_booking_idx ON booking_events (booking_id, created_at);
--> statement-breakpoint
CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES users (id) ON DELETE RESTRICT,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX audit_log_created_idx ON audit_log (created_at DESC);
--> statement-breakpoint
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX notifications_user_read_idx ON notifications (user_id, read_at);
--> statement-breakpoint
CREATE TABLE idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  key text NOT NULL,
  request_hash text NOT NULL,
  response_body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, key)
);
--> statement-breakpoint
CREATE TABLE settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE session (
  sid varchar NOT NULL PRIMARY KEY,
  sess json NOT NULL,
  expire timestamp(6) NOT NULL
);
--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON session (expire);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION bookspace_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'append-only table %', TG_TABLE_NAME;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER booking_events_append_only
  BEFORE UPDATE OR DELETE ON booking_events
  FOR EACH ROW EXECUTE FUNCTION bookspace_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION bookspace_reject_mutation();
--> statement-breakpoint
INSERT INTO roles (id, description) VALUES
  ('member', 'Browse resources and request bookings'),
  ('approver', 'Decide requests for assigned resources'),
  ('admin', 'Manage users, resources, policy, and reports');
--> statement-breakpoint
INSERT INTO settings (key, value) VALUES
  ('timezone', '"America/Los_Angeles"'::jsonb),
  ('pending_expiry_hours', '48'::jsonb);
