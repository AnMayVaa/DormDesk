#!/usr/bin/env python3
"""Builds the Grafana v2 files from code (easier to review than hand-edited JSON):
  infra/grafana/dashboard_ops.json   "DormDesk — Platform & Business" dashboard
  infra/grafana/alerts.json          alert rules (Grafana-managed, evaluated every minute on mon-01)
Every query reads an aggregate view or ops_replication() as dormdesk_ro — no names, phones, plates, slips.
Two data sources: dormdesk-pg = current primary, dormdesk-pg-standby = current standby (setup_grafana.sh
points them at DB_PRIMARY / DB_STANDBY from infra/topology.env; failover.sh re-points them).
    python3 infra/grafana/build.py
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
P = {"type": "grafana-postgresql-datasource", "uid": "dormdesk-pg"}
S = {"type": "grafana-postgresql-datasource", "uid": "dormdesk-pg-standby"}


def q(sql, ref="A", fmt="table"):
    return {"refId": ref, "format": fmt, "rawQuery": True, "editorMode": "code", "rawSql": sql}


def panel(kind, title, x, y, w, h, sql, ds=P, steps=None, unit=None, fmt="table", extra=None, desc=None):
    p = {"type": kind, "title": title, "gridPos": {"x": x, "y": y, "w": w, "h": h}, "datasource": ds,
         "targets": [q(sql, fmt=fmt)], "fieldConfig": {"defaults": {}, "overrides": []}}
    if steps:
        p["fieldConfig"]["defaults"]["color"] = {"mode": "thresholds"}
        p["fieldConfig"]["defaults"]["thresholds"] = {"mode": "absolute", "steps": [
            {"color": c, "value": v} for v, c in steps]}
    if unit:
        p["fieldConfig"]["defaults"]["unit"] = unit
    if desc:
        p["description"] = desc
    if extra:
        p.update(extra)
    return p


def row(title, y):
    return {"type": "row", "title": title, "gridPos": {"x": 0, "y": y, "w": 24, "h": 1}, "collapsed": False, "panels": []}


panels = [
    row("Platform — is everything up?", 0),
    panel("stat", "API servers alive", 0, 1, 4, 5,
          "SELECT count(*) FILTER (WHERE age_s < 150) AS alive, count(*) AS total FROM v_ops_heartbeats",
          steps=[(None, "red"), (1, "orange"), (2, "green")],
          desc="Each API process writes a heartbeat every minute (jobs.py). Silent > 150 s = down."),
    panel("stat", "Standbys streaming (primary)", 4, 1, 4, 5,
          "SELECT standby_count FROM ops_replication()", steps=[(None, "red"), (1, "green")],
          desc="pg_stat_replication on the current primary."),
    panel("stat", "Standby replay age", 8, 1, 4, 5,
          "SELECT last_replay_age_s FROM ops_replication() WHERE role = 'standby'", ds=S, unit="s",
          steps=[(None, "green"), (90, "orange"), (180, "red")],
          desc="Seconds since the standby replayed the last transaction. Heartbeats write every 60 s, "
               "so ~0–60 s is normal; > 180 s means replication is stuck."),
    panel("stat", "Last backup", 12, 1, 4, 5,
          "SELECT round(extract(epoch FROM now() - updated_at) / 3600, 1) AS hours FROM v_ops_meta WHERE key = 'backup_last_ok'",
          unit="h", steps=[(None, "green"), (26, "orange"), (50, "red")],
          desc="Written by tools/backup.sh after the laptop copy + restore test succeeded."),
    panel("stat", "TLS certificate", 16, 1, 4, 5,
          "SELECT (value::date - current_date) AS days_left FROM v_ops_meta WHERE key = 'tls_cert_not_after'",
          unit="d", steps=[(None, "red"), (14, "orange"), (30, "green")],
          desc="Let's Encrypt certificate on web-01 (deploy.sh web records its expiry)."),
    panel("stat", "Background job", 20, 1, 4, 5,
          "SELECT round(extract(epoch FROM now() - last_ok_at)) AS seconds_ago FROM v_ops_jobs WHERE name = 'settle_and_bill'",
          unit="s", steps=[(None, "green"), (180, "orange"), (300, "red")],
          desc="Settles bookings/parking and issues bills once a minute; one API holds the advisory lock."),
    panel("table", "API heartbeats", 0, 6, 12, 6,
          "SELECT host, db_host AS \"database\", version, age_s AS \"seconds ago\" FROM v_ops_heartbeats ORDER BY host"),
    panel("table", "Jobs", 12, 6, 12, 6,
          "SELECT name, last_run_at, last_ok_at, round(extract(epoch FROM now() - last_ok_at)) AS \"ok s ago\" FROM v_ops_jobs ORDER BY name"),
    row("Business — aggregates only (no personal data)", 12),
    panel("stat", "Bills unpaid this month", 0, 13, 6, 5,
          "SELECT count(*) FILTER (WHERE status IN ('unpaid','returned','overdue','slip_sent')) AS open, "
          "count(*) FILTER (WHERE status = 'overdue') AS overdue FROM v_bill_stats WHERE period = to_char(now() AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM')",
          steps=[(None, "green"), (1, "orange")]),
    panel("stat", "Collected this month (THB)", 6, 13, 6, 5,
          "SELECT coalesce(sum(total) FILTER (WHERE status = 'paid'), 0) / 100.0 AS baht FROM v_bill_stats "
          "WHERE period = to_char(now() AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM')", unit="none"),
    panel("stat", "Gym / pool now", 12, 13, 6, 5,
          "SELECT count(*) AS inside FROM v_checkin_stats WHERE started_at <= now() AND ended_at > now()"),
    panel("stat", "Parking permits", 18, 13, 6, 5,
          "SELECT count(*) FILTER (WHERE status = 'active') AS active, count(*) FILTER (WHERE status = 'pending') AS pending FROM v_parking_stats"),
    panel("barchart", "Bills by status per dorm (this month)", 0, 18, 12, 8,
          "SELECT dorm, count(*) FILTER (WHERE status = 'paid') AS paid, count(*) FILTER (WHERE status IN ('unpaid','returned','slip_sent')) AS open, "
          "count(*) FILTER (WHERE status = 'overdue') AS overdue FROM v_bill_stats WHERE period = to_char(now() AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM') GROUP BY dorm ORDER BY dorm",
          extra={"options": {"stacking": "normal", "xField": "dorm"}}),
    panel("timeseries", "Check-ins per hour (7 days)", 12, 18, 12, 8,
          "SELECT date_trunc('hour', started_at) AS time, kind, count(*) AS n FROM v_checkin_stats "
          "WHERE $__timeFilter(started_at) GROUP BY 1, 2 ORDER BY 1", fmt="time_series"),
    panel("barchart", "Bookings by status (30 days)", 0, 26, 12, 7,
          "SELECT status, count(*) AS n FROM v_booking_stats WHERE starts_at > now() - interval '30 days' GROUP BY status ORDER BY n DESC",
          extra={"options": {"xField": "status"}}),
    panel("timeseries", "Security events (per 15 min)", 12, 26, 12, 7,
          "SELECT $__timeGroupAlias(occurred_at, '15m'), type AS metric, count(*) AS value FROM v_security_events "
          "WHERE $__timeFilter(occurred_at) GROUP BY 1, 2 ORDER BY 1", fmt="time_series"),
]
dashboard = {"dashboard": {"uid": "dormdesk-ops", "title": "DormDesk — Platform & Business", "timezone": "Asia/Bangkok",
                           "time": {"from": "now-7d", "to": "now"}, "refresh": "1m", "schemaVersion": 39,
                           "tags": ["dormdesk"], "panels": panels}, "overwrite": True}


def rule(uid, title, sql, op, value, for_="2m", ds="dormdesk-pg", summary="", severity="warning", no_data="OK"):
    return {"uid": uid, "title": title, "ruleGroup": "dormdesk", "folderUID": "dormdesk", "condition": "C",
            "for": for_, "noDataState": no_data, "execErrState": "Error",
            "labels": {"severity": severity, "service": "dormdesk"}, "annotations": {"summary": summary},
            "data": [
                {"refId": "A", "relativeTimeRange": {"from": 600, "to": 0}, "datasourceUid": ds,
                 "model": {**q(sql), "intervalMs": 60000, "maxDataPoints": 43200}},
                {"refId": "C", "relativeTimeRange": {"from": 0, "to": 0}, "datasourceUid": "__expr__",
                 "model": {"refId": "C", "type": "threshold", "expression": "A",
                           "conditions": [{"evaluator": {"type": op, "params": [value]}}]}},
            ]}


alerts = [
    rule("dd-api-silent", "API server silent", "SELECT host, age_s::float AS value FROM v_ops_heartbeats", "gt", 150,
         summary="An API server has not written a heartbeat for > 150 s (crashed, or cannot reach the database).",
         severity="critical"),
    rule("dd-no-standby", "No standby streaming", "SELECT standby_count::float AS value FROM ops_replication()", "lt", 1,
         summary="The primary has no streaming standby: a database failure now means restoring from backup."),
    rule("dd-standby-lag", "Standby lagging", "SELECT coalesce(last_replay_age_s, 9999)::float AS value FROM ops_replication() WHERE role = 'standby'",
         "gt", 180, ds="dormdesk-pg-standby",
         summary="db standby replayed nothing for > 3 min (heartbeats write every minute, so it is stuck)."),
    rule("dd-login-spike", "Failed-login spike",
         "SELECT count(*)::float AS value FROM v_security_events WHERE type = 'login_failed' AND occurred_at > now() - interval '10 minutes'",
         "gt", 10, for_="0s", summary="More than 10 failed owner logins in 10 minutes — password guessing?"),
    rule("dd-job-stalled", "Background job stalled",
         "SELECT coalesce(extract(epoch FROM now() - max(last_ok_at)), 99999)::float AS value FROM v_ops_jobs WHERE name = 'settle_and_bill'",
         "gt", 300, summary="No API has completed the background job for 5 minutes (bills, no-shows, e-mails stop)."),
    rule("dd-backup-stale", "Backup older than 26 h",
         "SELECT coalesce(extract(epoch FROM now() - max(updated_at)) / 3600, 999)::float AS value FROM v_ops_meta WHERE key = 'backup_last_ok'",
         "gt", 26, for_="0s", summary="tools/backup.sh has not completed (with restore test) for more than a day."),
    rule("dd-cert-expiring", "TLS certificate expires in < 14 days",
         "SELECT (value::date - current_date)::float AS value FROM v_ops_meta WHERE key = 'tls_cert_not_after'",
         "lt", 14, for_="0s", summary="Run infra/tls/renew-letsencrypt.sh then infra/deploy.sh web."),
]

if __name__ == "__main__":
    json.dump(dashboard, open(os.path.join(HERE, "dashboard_ops.json"), "w"), ensure_ascii=False, indent=1)
    json.dump(alerts, open(os.path.join(HERE, "alerts.json"), "w"), ensure_ascii=False, indent=1)
    print(f"dashboard_ops.json: {len(panels)} panels, alerts.json: {len(alerts)} rules")
