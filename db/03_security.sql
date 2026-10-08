-- DormDesk security: roles, least privilege, Row-Level Security, SECURITY DEFINER lookups, Grafana views.
-- Run as postgres:  psql -v app_pw='...' -v ro_pw='...' -v repl_pw='...' -d dormdesk -f 03_security.sql
SET client_min_messages = warning;
-- Tables are owned by postgres. dormdesk_app is NOT the owner and has NOBYPASSRLS.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dormdesk_app') THEN
    CREATE ROLE dormdesk_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dormdesk_ro') THEN
    CREATE ROLE dormdesk_ro LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  -- streaming replication db-01 -> db-02: may replicate WAL, cannot read or change any table
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dormdesk_repl') THEN
    CREATE ROLE dormdesk_repl LOGIN REPLICATION NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;
ALTER ROLE dormdesk_app  PASSWORD :'app_pw';
ALTER ROLE dormdesk_ro   PASSWORD :'ro_pw';
ALTER ROLE dormdesk_repl PASSWORD :'repl_pw';
ALTER ROLE dormdesk_app SET statement_timeout = '15s';
ALTER ROLE dormdesk_ro  SET statement_timeout = '10s';

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO dormdesk_app, dormdesk_ro;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM dormdesk_app, dormdesk_ro, dormdesk_repl;

-- ---------- API account: only what the code needs, no DELETE / TRUNCATE / DROP anywhere ----------
GRANT SELECT                 ON dorms, admins, admin_dorms, categories                       TO dormdesk_app;
GRANT SELECT, INSERT, UPDATE ON rooms, dorm_categories, requests, request_photos             TO dormdesk_app;
GRANT SELECT, INSERT         ON request_events, security_events                              TO dormdesk_app;
GRANT SELECT, INSERT, UPDATE ON tenancies, dorm_settings, facilities, checkins, bookings,
                                booking_bans, booking_quota_extra, parking_permits, parking_waitlist,
                                guest_passes, objects, bills, bill_lines, bill_slips, meter_readings,
                                dorm_counters, fines, idem_keys, notifications, admin_sessions,
                                api_heartbeats, job_state                                    TO dormdesk_app;
GRANT SELECT, INSERT         ON bill_edits, fine_photos, messages                            TO dormdesk_app;
GRANT SELECT                 ON ops_meta                                                     TO dormdesk_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO dormdesk_app;

-- ---------- Row-Level Security: every tenant table is filtered by dorm (app.dorm_id) ----------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['rooms','dorm_categories','requests','request_photos','request_events',
                           'tenancies','dorm_settings','facilities','checkins','bookings','booking_bans',
                           'booking_quota_extra','parking_permits','parking_waitlist','guest_passes','objects',
                           'bills','bill_lines','bill_edits','bill_slips','meter_readings','dorm_counters',
                           'fines','fine_photos','messages','idem_keys','notifications'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS p_tenant ON %I', t);
    EXECUTE format($p$CREATE POLICY p_tenant ON %I
        USING      (dorm_id = NULLIF(current_setting('app.dorm_id', true), '')::int)
        WITH CHECK (dorm_id = NULLIF(current_setting('app.dorm_id', true), '')::int)$p$, t);
  END LOOP;
END $$;

-- ---------- second, RESTRICTIVE layer: inside a tenant request (app.tenancy_id set) only the CURRENT
-- tenancy's rows are visible, so a new tenant can never see the previous tenant's bills, parking, fines,
-- bookings or repair requests — even if a query forgets the filter. Owner requests do not set app.tenancy_id.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['requests','checkins','bookings','booking_bans','booking_quota_extra','parking_permits',
                           'parking_waitlist','guest_passes','bills','fines','messages'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS p_tenancy ON %I', t);
    EXECUTE format($p$CREATE POLICY p_tenancy ON %I AS RESTRICTIVE
        USING      (tenancy_id = COALESCE(NULLIF(current_setting('app.tenancy_id', true), '')::int, tenancy_id))
        WITH CHECK (tenancy_id = COALESCE(NULLIF(current_setting('app.tenancy_id', true), '')::int, tenancy_id))$p$, t);
  END LOOP;
END $$;

-- ---------- Lookups used BEFORE the dorm is known (return ids only) ----------
DROP FUNCTION IF EXISTS resolve_room(text);
CREATE FUNCTION resolve_room(p_code text)
RETURNS TABLE (dorm_id int, room_id int, tenancy_id int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT r.dorm_id, r.id, t.id FROM rooms r
   JOIN tenancies t ON t.room_id = r.id AND t.ended_at IS NULL
   WHERE r.room_code = p_code $$;

-- a tracking link only works while the tenancy that created it is still current
DROP FUNCTION IF EXISTS resolve_tracking(text);
CREATE FUNCTION resolve_tracking(p_token text)
RETURNS TABLE (dorm_id int, request_id int, tenancy_id int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT q.dorm_id, q.id, q.tenancy_id FROM requests q
   JOIN tenancies t ON t.id = q.tenancy_id AND t.ended_at IS NULL
   WHERE q.tracking_token = p_token $$;

-- admin endpoints addressed by object id: find its dorm, the API then checks admin_dorms
CREATE OR REPLACE FUNCTION request_dorm(p_id int)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT dorm_id FROM requests WHERE id = p_id $$;

CREATE OR REPLACE FUNCTION room_dorm(p_id int)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT dorm_id FROM rooms WHERE id = p_id $$;

CREATE OR REPLACE FUNCTION entity_dorm(p_kind text, p_id int)
RETURNS int LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN CASE p_kind
    WHEN 'bill'     THEN (SELECT dorm_id FROM bills            WHERE id = p_id)
    WHEN 'fine'     THEN (SELECT dorm_id FROM fines            WHERE id = p_id)
    WHEN 'permit'   THEN (SELECT dorm_id FROM parking_permits  WHERE id = p_id)
    WHEN 'waitlist' THEN (SELECT dorm_id FROM parking_waitlist WHERE id = p_id)
    WHEN 'guest'    THEN (SELECT dorm_id FROM guest_passes     WHERE id = p_id)
    WHEN 'facility' THEN (SELECT dorm_id FROM facilities       WHERE id = p_id)
    WHEN 'booking'  THEN (SELECT dorm_id FROM bookings         WHERE id = p_id)
    WHEN 'ban'      THEN (SELECT dorm_id FROM booking_bans     WHERE id = p_id)
    WHEN 'tenancy'  THEN (SELECT dorm_id FROM tenancies        WHERE id = p_id)
    ELSE NULL END;
END $$;

-- ops: replication health for alerts (works on primary and on standby, exposes numbers only)
CREATE OR REPLACE FUNCTION ops_replication()
RETURNS TABLE (role text, standby_count int, max_replay_lag_s numeric, last_replay_age_s numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  IF pg_is_in_recovery() THEN
    RETURN QUERY SELECT 'standby'::text, 0,
      NULL::numeric,
      round(extract(epoch FROM now() - pg_last_xact_replay_timestamp())::numeric, 1);
  ELSE
    RETURN QUERY SELECT 'primary'::text,
      (SELECT count(*)::int FROM pg_stat_replication WHERE state = 'streaming'),
      (SELECT round(max(extract(epoch FROM coalesce(replay_lag, interval '0')))::numeric, 1) FROM pg_stat_replication),
      NULL::numeric;
  END IF;
END $$;

REVOKE ALL ON FUNCTION resolve_room(text), resolve_tracking(text), request_dorm(int), room_dorm(int),
               entity_dorm(text, int), ops_replication() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_room(text), resolve_tracking(text), request_dorm(int), room_dorm(int),
               entity_dorm(text, int), ops_replication() TO dormdesk_app;
GRANT EXECUTE ON FUNCTION ops_replication() TO dormdesk_ro;

-- ---------- Grafana: aggregate views only, no personal data (no names, phones, slips, messages, plates) ----------
CREATE OR REPLACE VIEW v_security_events AS
  SELECT occurred_at, type, dorm_id FROM security_events;

CREATE OR REPLACE VIEW v_request_stats AS
  SELECT q.dorm_id, d.name AS dorm, c.name_th AS category, q.status, q.priority,
         q.created_at, q.done_at
  FROM requests q JOIN dorms d ON d.id = q.dorm_id JOIN categories c ON c.id = q.category_id;

CREATE OR REPLACE VIEW v_bill_stats AS
  SELECT b.dorm_id, d.name AS dorm, b.period, b.kind,
         CASE WHEN b.status IN ('unpaid','returned') AND b.due_date < (now() AT TIME ZONE 'Asia/Bangkok')::date
              THEN 'overdue' ELSE b.status END AS status,
         b.total, b.due_date, b.paid_at
  FROM bills b JOIN dorms d ON d.id = b.dorm_id WHERE b.status <> 'cancelled';

CREATE OR REPLACE VIEW v_checkin_stats AS
  SELECT c.dorm_id, f.name AS facility, f.kind, c.started_at,
         LEAST(c.expires_at, COALESCE(c.checked_out_at, c.expires_at)) AS ended_at
  FROM checkins c JOIN facilities f ON f.id = c.facility_id;

CREATE OR REPLACE VIEW v_booking_stats AS
  SELECT b.dorm_id, f.name AS facility, b.starts_at, b.status FROM bookings b JOIN facilities f ON f.id = b.facility_id;

CREATE OR REPLACE VIEW v_parking_stats AS
  SELECT dorm_id, vtype, status, over_quota, created_at FROM parking_permits;

CREATE OR REPLACE VIEW v_ops_heartbeats AS
  SELECT host, last_seen, db_host, version, round(extract(epoch FROM now() - last_seen)::numeric, 0) AS age_s FROM api_heartbeats;

CREATE OR REPLACE VIEW v_ops_meta AS SELECT key, value, updated_at FROM ops_meta;

CREATE OR REPLACE VIEW v_ops_jobs AS SELECT name, last_run_at, last_ok_at FROM job_state;

GRANT SELECT ON v_security_events, v_request_stats, v_bill_stats, v_checkin_stats, v_booking_stats,
                v_parking_stats, v_ops_heartbeats, v_ops_meta, v_ops_jobs TO dormdesk_ro;
