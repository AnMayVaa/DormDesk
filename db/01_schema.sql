-- DormDesk schema (run as postgres on database dormdesk)
-- Every customer table carries dorm_id (multi-tenant rule, HANDOFF 6.1)

CREATE TABLE IF NOT EXISTS dorms (
    id          serial PRIMARY KEY,
    name        text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admins (
    id             serial PRIMARY KEY,
    email          text NOT NULL UNIQUE,
    display_name   text NOT NULL,
    password_hash  text NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_dorms (
    admin_id  int NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    dorm_id   int NOT NULL REFERENCES dorms(id)  ON DELETE CASCADE,
    PRIMARY KEY (admin_id, dorm_id)
);

CREATE TABLE IF NOT EXISTS rooms (
    id               serial PRIMARY KEY,
    dorm_id          int  NOT NULL REFERENCES dorms(id) ON DELETE CASCADE,
    room_no          text NOT NULL,
    room_code        text NOT NULL UNIQUE,
    code_rotated_at  timestamptz,
    UNIQUE (dorm_id, room_no),
    UNIQUE (id, dorm_id)              -- lets requests prove room belongs to same dorm
);

CREATE TABLE IF NOT EXISTS categories (
    id       serial PRIMARY KEY,
    code     text NOT NULL UNIQUE,
    name_th  text NOT NULL,
    sort     int  NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS dorm_categories (
    dorm_id      int NOT NULL REFERENCES dorms(id) ON DELETE CASCADE,
    category_id  int NOT NULL REFERENCES categories(id),
    enabled      boolean NOT NULL DEFAULT true,
    PRIMARY KEY (dorm_id, category_id)
);

CREATE TABLE IF NOT EXISTS requests (
    id              serial PRIMARY KEY,
    dorm_id         int  NOT NULL,
    room_id         int  NOT NULL,
    category_id     int  NOT NULL REFERENCES categories(id),
    title           text NOT NULL,
    detail          text NOT NULL DEFAULT '',
    reporter_name   text NOT NULL,
    reporter_phone  text NOT NULL,
    reporter_email  text,
    consent_at      timestamptz NOT NULL,
    status          text NOT NULL DEFAULT 'received'
                    CHECK (status IN ('received','in_progress','done','rejected')),
    priority        text NOT NULL DEFAULT 'normal'
                    CHECK (priority IN ('normal','urgent')),
    tracking_token  text NOT NULL UNIQUE,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    done_at         timestamptz,
    FOREIGN KEY (room_id, dorm_id) REFERENCES rooms(id, dorm_id),
    UNIQUE (id, dorm_id)
);

CREATE TABLE IF NOT EXISTS request_photos (
    id          serial PRIMARY KEY,
    dorm_id     int  NOT NULL,
    request_id  int  NOT NULL,
    mime        text NOT NULL,
    size        int  NOT NULL,
    data        bytea NOT NULL,
    FOREIGN KEY (request_id, dorm_id) REFERENCES requests(id, dorm_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS request_events (
    id           serial PRIMARY KEY,
    dorm_id      int  NOT NULL,
    request_id   int  NOT NULL,
    from_status  text,
    to_status    text NOT NULL,
    note         text,
    actor        text NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (request_id, dorm_id) REFERENCES requests(id, dorm_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS security_events (
    id           bigserial PRIMARY KEY,
    occurred_at  timestamptz NOT NULL DEFAULT now(),
    type         text NOT NULL,     -- login_failed, rate_limited, cross_tenant, bad_room_code, bad_tracking_token, ...
    ip           text,
    dorm_id      int,
    detail       text
);

ALTER TABLE requests ADD COLUMN IF NOT EXISTS idem_key text;   -- Idempotency-Key from the browser
CREATE UNIQUE INDEX IF NOT EXISTS ux_requests_idem ON requests (dorm_id, idem_key);
CREATE INDEX IF NOT EXISTS ix_requests_dorm_status  ON requests (dorm_id, status);
CREATE INDEX IF NOT EXISTS ix_requests_room_created ON requests (room_id, created_at);
CREATE INDEX IF NOT EXISTS ix_photos_request        ON request_photos (request_id);
CREATE INDEX IF NOT EXISTS ix_events_request        ON request_events (request_id);
CREATE INDEX IF NOT EXISTS ix_security_time         ON security_events (occurred_at);
CREATE INDEX IF NOT EXISTS ix_security_type_detail  ON security_events (type, detail, occurred_at);

INSERT INTO categories (code, name_th, sort) VALUES
  ('electric','ไฟฟ้า',1), ('water','น้ำ / ประปา',2), ('aircon','แอร์',3),
  ('elevator','ลิฟต์',4), ('furniture','ของชำรุดในห้อง',5), ('laundry','Laundry',6),
  ('parcel','พัสดุ',7), ('parking','Parking',8), ('other','อื่น ๆ',9)
ON CONFLICT (code) DO NOTHING;
