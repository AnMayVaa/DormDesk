"""Exactly-once writes over an unreliable path.

Problem it solves (found by the team on the lab, 8 Oct 2026): an owner changed a repair status, the reply was lost
on the way back (502), but the change was already saved. Pressing the button again saved it again, and the history
showed the same event three times. Nginx retries and the browser's own retries make this worse, not better.

How: every POST / PATCH / PUT from our web pages carries an `Idempotency-Key` (common.js adds one per action and
reuses it when it retries). This ASGI middleware records the key BEFORE the handler runs and stores the reply AFTER.
  * same key again, first attempt finished  -> the stored reply is returned, the handler does not run again
  * same key again, first attempt still running -> wait for it (up to 12 s, under Nginx's 15 s read timeout), then
    return its reply; still running after that -> 409 in_progress + Retry-After, and common.js asks again
  * first attempt failed with 5xx (its transaction rolled back) -> the retry may run again
Keys are scoped to (method, path, session cookie), so one caller cannot replay another caller's reply.
Replies are kept 24 h (purge_http_idem(), called by the hourly job). Login/logout are not covered (cookies).
Creates also keep their in-transaction key (core.Idem) - that one is atomic with the row it creates.
"""
import asyncio
import hashlib
import json
import logging

import anyio

from .core import pool

log = logging.getLogger("dormdesk.idem")
METHODS = {"POST", "PATCH", "PUT"}
MAX_BODY = 256 * 1024
WAIT_S = 12          # must stay below proxy_read_timeout (15 s) in infra/nginx/dd_proxy.inc
IN_PROGRESS = json.dumps({"error": {"code": "in_progress", "message": "คำขอนี้กำลังดำเนินการ กรุณารอสักครู่"}},
                         ensure_ascii=False).encode()


def _scope(method: str, path: str, headers: dict) -> str:
    sess = ""
    for part in headers.get(b"cookie", b"").decode("latin-1").split(";"):
        k, _, v = part.strip().partition("=")
        if k == "dd_session":
            sess = v
    return hashlib.sha256(f"{method} {path} {sess}".encode()).hexdigest()


def _claim(scope: str, key: str):
    """'run' = we own the key · dict = stored reply · None = someone else is running it."""
    with pool.connection() as c:
        if c.execute("INSERT INTO http_idem (scope, key) VALUES (%s,%s) ON CONFLICT DO NOTHING RETURNING key",
                     (scope, key)).fetchone():
            return "run"
        # failed earlier (5xx, rolled back) or abandoned by a process that died -> take it over
        if c.execute("UPDATE http_idem SET status=NULL, created_at=now() WHERE scope=%s AND key=%s "
                     "AND (status = -1 OR (status IS NULL AND created_at < now() - interval '60 seconds')) RETURNING key",
                     (scope, key)).fetchone():
            return "run"
        r = c.execute("SELECT status, ctype, body FROM http_idem WHERE scope=%s AND key=%s", (scope, key)).fetchone()
        return dict(r) if r and r["status"] is not None else None


def _store(scope: str, key: str, status: int, ctype: str, body: bytes):
    with pool.connection() as c:
        if status >= 500 or len(body) > MAX_BODY:
            c.execute("UPDATE http_idem SET status=-1 WHERE scope=%s AND key=%s", (scope, key))
        else:
            c.execute("UPDATE http_idem SET status=%s, ctype=%s, body=%s WHERE scope=%s AND key=%s",
                      (status, ctype, body, scope, key))


class IdempotencyMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if (scope["type"] != "http" or scope["method"] not in METHODS or not scope["path"].startswith("/api/")
                or scope["path"].startswith("/api/auth/")):
            return await self.app(scope, receive, send)
        headers = dict(scope["headers"])
        key = headers.get(b"idempotency-key", b"").decode("latin-1").strip()[:64]
        if not key:
            return await self.app(scope, receive, send)
        sc = _scope(scope["method"], scope["path"], headers)
        try:
            state = await anyio.to_thread.run_sync(_claim, sc, key)
            waited = 0.0
            while state is None and waited < WAIT_S:
                await asyncio.sleep(0.5)
                waited += 0.5
                state = await anyio.to_thread.run_sync(_claim, sc, key)
        except Exception:                       # bookkeeping must never block a write: fall back to plain handling
            log.exception("idempotency bookkeeping failed")
            return await self.app(scope, receive, send)
        if state is None:
            return await _reply(send, 409, "application/json", IN_PROGRESS, retry_after=True)
        if state != "run":
            return await _reply(send, state["status"], state["ctype"] or "application/json", bytes(state["body"] or b""), replay=True)

        status, ctype, chunks = 500, "application/json", []

        async def capture(msg):
            nonlocal status, ctype
            if msg["type"] == "http.response.start":
                status = msg["status"]
                for k, v in msg.get("headers", []):
                    if k.lower() == b"content-type":
                        ctype = v.decode("latin-1")
            elif msg["type"] == "http.response.body":
                chunks.append(msg.get("body", b""))
            await send(msg)

        try:
            await self.app(scope, receive, capture)
        finally:
            try:
                await anyio.to_thread.run_sync(_store, sc, key, status, ctype, b"".join(chunks))
            except Exception:
                log.exception("could not store idempotent reply")


async def _reply(send, status: int, ctype: str, body: bytes, replay: bool = False, retry_after: bool = False):
    headers = [(b"content-type", ctype.encode("latin-1")), (b"content-length", str(len(body)).encode())]
    if replay:
        headers.append((b"idempotent-replay", b"true"))
    if retry_after:
        headers.append((b"retry-after", b"2"))
    await send({"type": "http.response.start", "status": status, "headers": headers})
    await send({"type": "http.response.body", "body": body})
