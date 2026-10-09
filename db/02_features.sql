-- DormDesk v2 schema: tenancy, feature switches, facilities, bookings, parking, bills, fines, messages,
SET client_min_messages = warning;
-- object store metadata, revocable sessions and ops tables.  Idempotent: safe to run on a live database.
-- Run as postgres AFTER 01_schema.sql and BEFORE 03_security.sql (which sets grants + RLS for every table).
-- Money is always integer satang (1 baht = 100). Times are timestamptz; "today" means Asia/Bangkok.

CREATE EXTENSION IF NOT EXISTS btree_gist;   -- exclusion constraint for double bookings

-- ============================================================ tenancy (one row per tenant period of a room)
CREATE TABLE IF NOT EXISTS tenancies (
    id                serial PRIMARY KEY,
    dorm_id           int  NOT NULL,
    room_id           int  NOT NULL,
    started_at        timestamptz NOT NULL DEFAULT now(),
    ended_at          timestamptz,
    contact_email     text,                    -- optional, set by the tenant for notifications
    email_consent_at  timestamptz,
    FOREIGN KEY (room_id, dorm_id) REFERENCES rooms(id, dorm_id),
    UNIQUE (id, dorm_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_tenancy_current ON tenancies (room_id) WHERE ended_at IS NULL;

-- every room has exactly one current tenancy
INSERT INTO tenancies (dorm_id, room_id, started_at)
SELECT r.dorm_id, r.id, COALESCE((SELECT min(q.created_at) FROM requests q WHERE q.room_id = r.id), now()) - interval '1 day'
FROM rooms r WHERE NOT EXISTS (SELECT 1 FROM tenancies t WHERE t.room_id = r.id AND t.ended_at IS NULL);

ALTER TABLE rooms    ADD COLUMN IF NOT EXISTS rent int NOT NULL DEFAULT 0 CHECK (rent >= 0);   -- monthly rent, satang
ALTER TABLE requests ADD COLUMN IF NOT EXISTS tenancy_id int;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS pii_purged_at timestamptz;                      -- PDPA 180-day clean-up
UPDATE requests q SET tenancy_id = t.id FROM tenancies t
 WHERE q.tenancy_id IS NULL AND t.room_id = q.room_id AND t.ended_at IS NULL;
ALTER TABLE requests ALTER COLUMN tenancy_id SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'requests_tenancy_fk') THEN
    ALTER TABLE requests ADD CONSTRAINT requests_tenancy_fk FOREIGN KEY (tenancy_id, dorm_id) REFERENCES tenancies(id, dorm_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_requests_tenancy ON requests (tenancy_id);

-- ============================================================ per-dorm feature switches + rules (one row per dorm)
CREATE TABLE IF NOT EXISTS dorm_settings (
    dorm_id                  int PRIMARY KEY REFERENCES dorms(id) ON DELETE CASCADE,
    f_fitness                boolean NOT NULL DEFAULT false,
    f_pool                   boolean NOT NULL DEFAULT false,
    f_spaces                 boolean NOT NULL DEFAULT false,
    f_parking                boolean NOT NULL DEFAULT false,
    f_bills                  boolean NOT NULL DEFAULT false,
    f_fines                  boolean NOT NULL DEFAULT false,
    checkin_hours            int NOT NULL DEFAULT 3  CHECK (checkin_hours BETWEEN 1 AND 12),
    checkin_per_room         int NOT NULL DEFAULT 2  CHECK (checkin_per_room BETWEEN 1 AND 10),
    booking_per_week         int NOT NULL DEFAULT 2  CHECK (booking_per_week BETWEEN 0 AND 21),
    booking_confirm_min      int NOT NULL DEFAULT 30 CHECK (booking_confirm_min BETWEEN 5 AND 120),
    booking_cancel_before_h  int NOT NULL DEFAULT 2  CHECK (booking_cancel_before_h BETWEEN 0 AND 72),
    strike_limit             int NOT NULL DEFAULT 2  CHECK (strike_limit BETWEEN 1 AND 10),
    strike_window_d          int NOT NULL DEFAULT 30 CHECK (strike_window_d BETWEEN 1 AND 365),
    ban_days                 int NOT NULL DEFAULT 14 CHECK (ban_days BETWEEN 1 AND 365),
    quota_car                int NOT NULL DEFAULT 1  CHECK (quota_car BETWEEN 0 AND 10),
    quota_moto               int NOT NULL DEFAULT 1  CHECK (quota_moto BETWEEN 0 AND 10),
    spots_car                int NOT NULL DEFAULT 0  CHECK (spots_car >= 0),    -- total spaces in the lot (0 = unlimited)
    spots_moto               int NOT NULL DEFAULT 0  CHECK (spots_moto >= 0),
    fee_car                  int NOT NULL DEFAULT 0  CHECK (fee_car >= 0),      -- satang / month
    fee_moto                 int NOT NULL DEFAULT 0  CHECK (fee_moto >= 0),
    parking_cancel_days      int NOT NULL DEFAULT 15 CHECK (parking_cancel_days BETWEEN 1 AND 90),
    guest_pass_approval      boolean NOT NULL DEFAULT false,
    promptpay_id             text CHECK (promptpay_id IS NULL OR promptpay_id ~ '^[0-9]{10}$|^[0-9]{13}$'),
    bill_auto                boolean NOT NULL DEFAULT false,
    bill_issue_day           int NOT NULL DEFAULT 1  CHECK (bill_issue_day BETWEEN 1 AND 28),
    bill_due_day             int NOT NULL DEFAULT 10 CHECK (bill_due_day BETWEEN 1 AND 28),
    common_fee               int NOT NULL DEFAULT 0  CHECK (common_fee >= 0),
    water_mode               text NOT NULL DEFAULT 'meter' CHECK (water_mode IN ('meter','flat','none')),
    water_rate               int NOT NULL DEFAULT 1800 CHECK (water_rate >= 0),  -- satang / unit
    water_flat               int NOT NULL DEFAULT 0 CHECK (water_flat >= 0),
    elec_mode                text NOT NULL DEFAULT 'meter' CHECK (elec_mode IN ('meter','flat','none')),
    elec_rate                int NOT NULL DEFAULT 700 CHECK (elec_rate >= 0),
    elec_flat                int NOT NULL DEFAULT 0 CHECK (elec_flat >= 0),
    late_fee_enabled         boolean NOT NULL DEFAULT false,
    late_fee_grace_d         int NOT NULL DEFAULT 3 CHECK (late_fee_grace_d BETWEEN 0 AND 60),
    late_fee_per_day         int NOT NULL DEFAULT 5000 CHECK (late_fee_per_day >= 0),
    contact_phone            text,
    contact_email            text,
    updated_at               timestamptz NOT NULL DEFAULT now()
);
INSERT INTO dorm_settings (dorm_id) SELECT id FROM dorms ON CONFLICT DO NOTHING;

-- ============================================================ facilities: fitness / pool (check-in) and spaces (booking)
CREATE TABLE IF NOT EXISTS facilities (
    id            serial PRIMARY KEY,
    dorm_id       int  NOT NULL REFERENCES dorms(id) ON DELETE CASCADE,
    name          text NOT NULL,
    kind          text NOT NULL CHECK (kind IN ('fitness','pool','space')),
    capacity      int  CHECK (capacity IS NULL OR capacity > 0),
    open_from     time NOT NULL DEFAULT '06:00',
    open_to       time NOT NULL DEFAULT '22:00',
    slot_minutes  int  NOT NULL DEFAULT 60 CHECK (slot_minutes IN (30, 60, 90, 120)),
    qr_token      text NOT NULL UNIQUE,
    enabled       boolean NOT NULL DEFAULT true,
    closed_note   text,                         -- temporary closure ("pool cleaning")
    sort          int  NOT NULL DEFAULT 0,
    UNIQUE (id, dorm_id)
);

CREATE TABLE IF NOT EXISTS checkins (
    id              serial PRIMARY KEY,
    dorm_id         int NOT NULL,
    tenancy_id      int NOT NULL,
    facility_id     int NOT NULL,
    started_at      timestamptz NOT NULL DEFAULT now(),
    expires_at      timestamptz NOT NULL,
    checked_out_at  timestamptz,
    FOREIGN KEY (tenancy_id, dorm_id)  REFERENCES tenancies(id, dorm_id),
    FOREIGN KEY (facility_id, dorm_id) REFERENCES facilities(id, dorm_id),
    UNIQUE (id, dorm_id)
);
CREATE INDEX IF NOT EXISTS ix_checkins_fac ON checkins (facility_id, expires_at);
CREATE INDEX IF NOT EXISTS ix_checkins_ten ON checkins (tenancy_id, expires_at);

CREATE TABLE IF NOT EXISTS bookings (
    id            serial PRIMARY KEY,
    dorm_id       int NOT NULL,
    tenancy_id    int NOT NULL,
    facility_id   int NOT NULL,
    starts_at     timestamptz NOT NULL,
    ends_at       timestamptz NOT NULL,
    status        text NOT NULL DEFAULT 'booked'
                  CHECK (status IN ('booked','confirmed','cancelled','cancelled_late','no_show','void')),
    created_at    timestamptz NOT NULL DEFAULT now(),
    confirmed_at  timestamptz,
    cancelled_at  timestamptz,
    CHECK (ends_at > starts_at),
    FOREIGN KEY (tenancy_id, dorm_id)  REFERENCES tenancies(id, dorm_id),
    FOREIGN KEY (facility_id, dorm_id) REFERENCES facilities(id, dorm_id),
    UNIQUE (id, dorm_id)
);
DO $$ BEGIN   -- two live bookings can never overlap on the same space, even if two API servers race
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_no_overlap') THEN
    ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap EXCLUDE USING gist
      (facility_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&) WHERE (status IN ('booked','confirmed'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_bookings_ten ON bookings (tenancy_id, starts_at);

CREATE TABLE IF NOT EXISTS booking_bans (
    id          serial PRIMARY KEY,
    dorm_id     int NOT NULL,
    tenancy_id  int NOT NULL,
    starts_at   timestamptz NOT NULL DEFAULT now(),
    until       timestamptz NOT NULL,
    lifted_at   timestamptz,
    lifted_by   int,
    FOREIGN KEY (tenancy_id, dorm_id) REFERENCES tenancies(id, dorm_id)
);
CREATE TABLE IF NOT EXISTS booking_quota_extra (
    dorm_id     int  NOT NULL,
    tenancy_id  int  NOT NULL,
    week_start  date NOT NULL,
    extra       int  NOT NULL CHECK (extra BETWEEN 0 AND 20),
    PRIMARY KEY (tenancy_id, week_start),
    FOREIGN KEY (tenancy_id, dorm_id) REFERENCES tenancies(id, dorm_id)
);

-- ============================================================ parking (no IoT)
CREATE TABLE IF NOT EXISTS parking_permits (
    id                serial PRIMARY KEY,
    dorm_id           int  NOT NULL,
    tenancy_id        int  NOT NULL,
    plate             text NOT NULL,
    province          text NOT NULL DEFAULT '',
    vtype             text NOT NULL CHECK (vtype IN ('car','moto')),
    brand_color       text NOT NULL DEFAULT '',
    status            text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','returned','active','cancel_notice','cancelled','withdrawn')),
    sticker           text,
    spot              text,
    fee               int  NOT NULL DEFAULT 0,
    over_quota        boolean NOT NULL DEFAULT false,
    cancel_reason     text,
    cancel_notice_at  timestamptz,
    cancel_due_at     timestamptz,
    ack_at            timestamptz,
    cancelled_at      timestamptz,
    approved_at       timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (tenancy_id, dorm_id) REFERENCES tenancies(id, dorm_id),
    UNIQUE (id, dorm_id)
);
CREATE INDEX IF NOT EXISTS ix_permits_ten ON parking_permits (tenancy_id);

CREATE TABLE IF NOT EXISTS parking_waitlist (
    id          serial PRIMARY KEY,
    dorm_id     int  NOT NULL,
    tenancy_id  int  NOT NULL,
    vtype       text NOT NULL CHECK (vtype IN ('car','moto')),
    status      text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','offered','cancelled')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    offered_at  timestamptz,
    FOREIGN KEY (tenancy_id, dorm_id) REFERENCES tenancies(id, dorm_id)
);

CREATE TABLE IF NOT EXISTS guest_passes (
    id          serial PRIMARY KEY,
    dorm_id     int  NOT NULL,
    tenancy_id  int  NOT NULL,
    plate       text NOT NULL,
    valid_date  date NOT NULL,
    status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending','rejected','cancelled')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (tenancy_id, dorm_id) REFERENCES tenancies(id, dorm_id)
);

-- ============================================================ object store metadata (photos, slips, fine evidence)
-- The bytes live in the private object store (SeaweedFS S3, encrypted by the API with AES-256-GCM).
-- This row is what RLS protects: no row visible = the API never fetches the object.
CREATE TABLE IF NOT EXISTS objects (
    id          serial PRIMARY KEY,
    dorm_id     int  NOT NULL REFERENCES dorms(id),
    kind        text NOT NULL CHECK (kind IN ('request_photo','slip','fine_photo')),
    key         text NOT NULL UNIQUE,          -- d<dorm>/<kind>/<random>
    mime        text NOT NULL,
    size        int  NOT NULL,                 -- plaintext size
    sha256      text NOT NULL,                 -- of the stored (encrypted) bytes, for backup verification
    key_id      text NOT NULL,                 -- which encryption key (rotation)
    created_at  timestamptz NOT NULL DEFAULT now(),
    purged_at   timestamptz,
    UNIQUE (id, dorm_id)
);
ALTER TABLE request_photos ADD COLUMN IF NOT EXISTS object_id int;
ALTER TABLE request_photos ALTER COLUMN data DROP NOT NULL;   -- old photos stay as bytea, new ones go to the object store

-- ============================================================ bills, slips, receipts
CREATE TABLE IF NOT EXISTS bills (
    id          serial PRIMARY KEY,
    dorm_id     int  NOT NULL,
    tenancy_id  int  NOT NULL,
    room_id     int  NOT NULL,
    period      text NOT NULL CHECK (period ~ '^[0-9]{4}-[0-9]{2}$|^F[0-9]+$'),  -- YYYY-MM, or F<fine id> for a separate fine bill
    kind        text NOT NULL DEFAULT 'monthly' CHECK (kind IN ('monthly','separate')),
    status      text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','unpaid','slip_sent','returned','paid','cancelled')),
    due_date    date NOT NULL,
    total       int  NOT NULL DEFAULT 0,
    late_fee    int  NOT NULL DEFAULT 0,        -- charged on the next bill when paid late
    late_fee_billed boolean NOT NULL DEFAULT false,
    receipt_no  text,
    issued_at   timestamptz,
    paid_at     timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (tenancy_id, dorm_id) REFERENCES tenancies(id, dorm_id),
    FOREIGN KEY (room_id, dorm_id)    REFERENCES rooms(id, dorm_id),
    UNIQUE (room_id, tenancy_id, period),   -- auto-billing can never create the same bill twice
    UNIQUE (id, dorm_id)
);
CREATE INDEX IF NOT EXISTS ix_bills_dorm_period ON bills (dorm_id, period);

CREATE TABLE IF NOT EXISTS bill_lines (
    id       serial PRIMARY KEY,
    dorm_id  int  NOT NULL,
    bill_id  int  NOT NULL,
    preset   text NOT NULL CHECK (preset IN ('rent','water','electric','common','parking','fine','late_fee','adjust','other')),
    label    text NOT NULL,
    note     text NOT NULL DEFAULT '',
    amount   int  NOT NULL,                     -- may be negative for 'adjust'
    ref_type text,                              -- permit / fine / bill (late fee source)
    ref_id   int,
    sort     int  NOT NULL DEFAULT 0,
    FOREIGN KEY (bill_id, dorm_id) REFERENCES bills(id, dorm_id)
);
CREATE INDEX IF NOT EXISTS ix_bill_lines_bill ON bill_lines (bill_id);

CREATE TABLE IF NOT EXISTS bill_edits (
    id        serial PRIMARY KEY,
    dorm_id   int  NOT NULL,
    bill_id   int  NOT NULL,
    before    jsonb NOT NULL,
    after     jsonb NOT NULL,
    reason    text NOT NULL,
    admin_id  int  NOT NULL,
    at        timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (bill_id, dorm_id) REFERENCES bills(id, dorm_id)
);

CREATE TABLE IF NOT EXISTS bill_slips (
    id          serial PRIMARY KEY,
    dorm_id     int  NOT NULL,
    bill_id     int  NOT NULL,
    object_id   int  NOT NULL,
    sent_at     timestamptz NOT NULL DEFAULT now(),
    decision    text NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending','confirmed','returned')),
    decided_at  timestamptz,
    decided_by  int,
    message     text,
    FOREIGN KEY (bill_id, dorm_id)   REFERENCES bills(id, dorm_id),
    FOREIGN KEY (object_id, dorm_id) REFERENCES objects(id, dorm_id)
);

CREATE TABLE IF NOT EXISTS meter_readings (
    dorm_id      int  NOT NULL,
    room_id      int  NOT NULL,
    period       text NOT NULL CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),
    water_units  numeric(10,2),
    elec_units   numeric(10,2),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (room_id, period),
    FOREIGN KEY (room_id, dorm_id) REFERENCES rooms(id, dorm_id)
);

CREATE TABLE IF NOT EXISTS dorm_counters (            -- gapless receipt numbers per dorm
    dorm_id  int  NOT NULL REFERENCES dorms(id),
    name     text NOT NULL,
    value    int  NOT NULL DEFAULT 0,
    PRIMARY KEY (dorm_id, name)
);

-- ============================================================ fines
CREATE TABLE IF NOT EXISTS fines (
    id               serial PRIMARY KEY,
    dorm_id          int  NOT NULL,
    tenancy_id       int  NOT NULL,
    room_id          int  NOT NULL,
    preset           text NOT NULL CHECK (preset IN ('late','damage','noise','parking','other')),
    title            text NOT NULL,
    amount           int  NOT NULL CHECK (amount > 0),
    original_amount  int  NOT NULL,
    reason           text NOT NULL,
    status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open','disputed','confirmed','cancelled','billed')),
    billing          text NOT NULL DEFAULT 'next_bill' CHECK (billing IN ('next_bill','separate')),
    bill_id          int,
    created_by       int  NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (tenancy_id, dorm_id) REFERENCES tenancies(id, dorm_id),
    FOREIGN KEY (room_id, dorm_id)    REFERENCES rooms(id, dorm_id),
    UNIQUE (id, dorm_id)
);
CREATE TABLE IF NOT EXISTS fine_photos (
    id         serial PRIMARY KEY,
    dorm_id    int NOT NULL,
    fine_id    int NOT NULL,
    object_id  int NOT NULL,
    FOREIGN KEY (fine_id, dorm_id)   REFERENCES fines(id, dorm_id),
    FOREIGN KEY (object_id, dorm_id) REFERENCES objects(id, dorm_id)
);

-- ============================================================ one message thread per subject (no LINE-style mixing)
CREATE TABLE IF NOT EXISTS messages (
    id            serial PRIMARY KEY,
    dorm_id       int  NOT NULL,
    tenancy_id    int  NOT NULL,
    subject_type  text NOT NULL CHECK (subject_type IN ('permit','fine','bill')),
    subject_id    int  NOT NULL,
    author        text NOT NULL,                -- 'tenant' or 'admin:<id>'
    body          text NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
    created_at    timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (tenancy_id, dorm_id) REFERENCES tenancies(id, dorm_id)
);
CREATE INDEX IF NOT EXISTS ix_messages_subject ON messages (subject_type, subject_id, created_at);

-- ============================================================ idempotency (Nginx retries POSTs on the other API server)
CREATE TABLE IF NOT EXISTS idem_keys (
    dorm_id     int  NOT NULL,
    scope       text NOT NULL,
    key         text NOT NULL,
    status      int,
    response    jsonb,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (dorm_id, scope, key)
);

-- "send this e-mail once" (the background job may run on any API server)
CREATE TABLE IF NOT EXISTS notifications (
    dorm_id   int  NOT NULL,
    kind      text NOT NULL,
    ref_id    int  NOT NULL,
    sent_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (dorm_id, kind, ref_id)
);

-- ============================================================ revocable admin sessions (cookie = random token, DB keeps sha256)
CREATE TABLE IF NOT EXISTS admin_sessions (
    id            text PRIMARY KEY,                  -- sha256(token) hex
    admin_id      int  NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    created_at    timestamptz NOT NULL DEFAULT now(),
    last_seen_at  timestamptz NOT NULL DEFAULT now(),
    expires_at    timestamptz NOT NULL,
    revoked_at    timestamptz,
    ip            text,
    user_agent    text
);
CREATE INDEX IF NOT EXISTS ix_sessions_admin ON admin_sessions (admin_id, revoked_at);

-- ============================================================ ops: heartbeats, job state, deploy metadata
CREATE TABLE IF NOT EXISTS api_heartbeats (
    host       text PRIMARY KEY,
    last_seen  timestamptz NOT NULL DEFAULT now(),
    db_host    text,
    version    text
);
CREATE TABLE IF NOT EXISTS job_state (
    name         text PRIMARY KEY,
    last_run_at  timestamptz,
    last_ok_at   timestamptz,
    detail       text
);
CREATE TABLE IF NOT EXISTS ops_meta (            -- written by deploy scripts (e.g. TLS certificate expiry)
    key         text PRIMARY KEY,
    value       text NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ============================================================ exactly-once writes (api/app/idempotency.py)
-- A POST/PATCH/PUT that carries an Idempotency-Key runs once; a retry gets the stored reply. No tenant data
-- columns: scope = sha256(method, path, session), kept 24 h and purged by purge_http_idem().
CREATE TABLE IF NOT EXISTS http_idem (
    scope       text NOT NULL,
    key         text NOT NULL,
    status      int,                      -- NULL running · -1 failed (may run again) · else stored HTTP status
    ctype       text,
    body        bytea,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (scope, key)
);
CREATE INDEX IF NOT EXISTS ix_http_idem_created ON http_idem (created_at);
