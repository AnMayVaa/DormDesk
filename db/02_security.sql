-- DormDesk security: roles, least privilege, Row-Level Security, SECURITY DEFINER lookups
-- Run as postgres:  psql -v app_pw='...' -v ro_pw='...' -d dormdesk -f 02_security.sql
-- Tables are owned by postgres. dormdesk_app is NOT the owner and has NOBYPASSRLS.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dormdesk_app') THEN
    CREATE ROLE dormdesk_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dormdesk_ro') THEN
    CREATE ROLE dormdesk_ro LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;
ALTER ROLE dormdesk_app PASSWORD :'app_pw';
ALTER ROLE dormdesk_ro  PASSWORD :'ro_pw';

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO dormdesk_app, dormdesk_ro;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM dormdesk_app, dormdesk_ro;

-- ---------- API account: only what the code needs, no DELETE / DROP ----------
GRANT SELECT                 ON dorms, admins, admin_dorms, categories        TO dormdesk_app;
GRANT SELECT, INSERT, UPDATE ON rooms, dorm_categories, requests              TO dormdesk_app;
GRANT SELECT, INSERT         ON request_photos, request_events                TO dormdesk_app;
GRANT SELECT, INSERT         ON security_events                               TO dormdesk_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO dormdesk_app;

-- ---------- Row-Level Security on every tenant table ----------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['rooms','dorm_categories','requests','request_photos','request_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS p_tenant ON %I', t);
    EXECUTE format($p$CREATE POLICY p_tenant ON %I
        USING      (dorm_id = NULLIF(current_setting('app.dorm_id', true), '')::int)
        WITH CHECK (dorm_id = NULLIF(current_setting('app.dorm_id', true), '')::int)$p$, t);
  END LOOP;
END $$;

-- ---------- Lookups used BEFORE the dorm is known (return ids only) ----------
CREATE OR REPLACE FUNCTION resolve_room(p_code text)
RETURNS TABLE (dorm_id int, room_id int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT r.dorm_id, r.id FROM rooms r WHERE r.room_code = p_code $$;

CREATE OR REPLACE FUNCTION resolve_tracking(p_token text)
RETURNS TABLE (dorm_id int, request_id int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT q.dorm_id, q.id FROM requests q WHERE q.tracking_token = p_token $$;

-- admin endpoints addressed by object id: find its dorm, API then checks admin_dorms
CREATE OR REPLACE FUNCTION request_dorm(p_id int)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT dorm_id FROM requests WHERE id = p_id $$;

CREATE OR REPLACE FUNCTION room_dorm(p_id int)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT dorm_id FROM rooms WHERE id = p_id $$;

REVOKE ALL ON FUNCTION resolve_room(text), resolve_tracking(text), request_dorm(int), room_dorm(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_room(text), resolve_tracking(text), request_dorm(int), room_dorm(int) TO dormdesk_app;

-- ---------- Grafana: aggregate views only, no personal data ----------
CREATE OR REPLACE VIEW v_security_events AS
  SELECT occurred_at, type, dorm_id FROM security_events;

CREATE OR REPLACE VIEW v_request_stats AS
  SELECT q.dorm_id, d.name AS dorm, c.name_th AS category, q.status, q.priority,
         q.created_at, q.done_at
  FROM requests q JOIN dorms d ON d.id = q.dorm_id JOIN categories c ON c.id = q.category_id;

GRANT SELECT ON v_security_events, v_request_stats TO dormdesk_ro;
