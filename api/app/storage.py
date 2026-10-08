"""Object storage for photos, payment slips and fine evidence.

store-01 runs SeaweedFS (S3 API) in the private subnet. Only the API tier can reach it (firewall), it needs an
access key with rights on one bucket, and the connection is HTTPS verified against the DormDesk CA.
Every object is encrypted by the API with AES-256-GCM before upload, so the object store (and its backups)
only ever hold ciphertext. The key's id is stored with the metadata row in PostgreSQL (`objects`), and that
row is protected by Row-Level Security: if the row is not visible to the dorm, the API never fetches the object.

Small dependency-free S3 client (AWS Signature V4, path-style) — enough for PUT / GET / DELETE / LIST.
"""
import base64
import datetime as dt
import hashlib
import hmac
import os
import secrets
import ssl
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from typing import Iterator, Optional, Tuple

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

S3_URL = os.environ.get("S3_URL", "")                 # e.g. https://10.0.2.155:8333
S3_BUCKET = os.environ.get("S3_BUCKET", "dormdesk")
S3_ACCESS_KEY = os.environ.get("S3_ACCESS_KEY", "")
S3_SECRET_KEY = os.environ.get("S3_SECRET_KEY", "")
S3_REGION = os.environ.get("S3_REGION", "us-east-1")
S3_CA_FILE = os.environ.get("S3_CA_FILE", "")         # DormDesk CA that signed store-01's certificate
# OBJ_KEYS = "k1:<base64 32 bytes>,k2:<...>"  OBJ_KEY_ID = id used for new objects (old ids stay readable)
_KEYS = {k: base64.b64decode(v) for k, v in (x.split(":", 1) for x in os.environ.get("OBJ_KEYS", "").split(",") if ":" in x)}
OBJ_KEY_ID = os.environ.get("OBJ_KEY_ID", next(iter(_KEYS), ""))
MAGIC = b"DD1"


def enabled() -> bool:
    return bool(S3_URL and S3_ACCESS_KEY and S3_SECRET_KEY and OBJ_KEY_ID in _KEYS)


class StorageError(Exception):
    pass


# ---------------------------------------------------------------- encryption (AES-256-GCM, AAD = object key)
def encrypt(key_name: str, plain: bytes) -> Tuple[str, bytes]:
    nonce = secrets.token_bytes(12)
    ct = AESGCM(_KEYS[OBJ_KEY_ID]).encrypt(nonce, plain, key_name.encode())
    return OBJ_KEY_ID, MAGIC + nonce + ct


def decrypt(key_id: str, key_name: str, blob: bytes) -> bytes:
    if not blob.startswith(MAGIC) or key_id not in _KEYS:
        raise StorageError("unknown object format or key id")
    return AESGCM(_KEYS[key_id]).decrypt(blob[3:15], blob[15:], key_name.encode())


# ---------------------------------------------------------------- S3 SigV4 client
def _ctx() -> Optional[ssl.SSLContext]:
    if not S3_URL.startswith("https"):
        return None
    c = ssl.create_default_context(cafile=S3_CA_FILE or None)
    return c


_SSL = None


def _request(method: str, path: str, query: dict = None, body: bytes = b"", timeout=15):
    global _SSL
    if _SSL is None:
        _SSL = _ctx() or False
    u = urllib.parse.urlsplit(S3_URL)
    host = u.netloc
    now = dt.datetime.now(dt.timezone.utc)
    amz_date, day = now.strftime("%Y%m%dT%H%M%SZ"), now.strftime("%Y%m%d")
    payload_hash = hashlib.sha256(body).hexdigest()
    canon_uri = urllib.parse.quote(path, safe="/-_.~")
    q = sorted((query or {}).items())
    canon_q = "&".join(f"{urllib.parse.quote(k, safe='-_.~')}={urllib.parse.quote(str(v), safe='-_.~')}" for k, v in q)
    headers = {"host": host, "x-amz-content-sha256": payload_hash, "x-amz-date": amz_date}
    signed = ";".join(sorted(headers))
    canon_h = "".join(f"{k}:{headers[k]}\n" for k in sorted(headers))
    canon = "\n".join([method, canon_uri, canon_q, canon_h, signed, payload_hash])
    scope = f"{day}/{S3_REGION}/s3/aws4_request"
    sts = "\n".join(["AWS4-HMAC-SHA256", amz_date, scope, hashlib.sha256(canon.encode()).hexdigest()])
    k = hmac.new(("AWS4" + S3_SECRET_KEY).encode(), day.encode(), hashlib.sha256).digest()
    for part in (S3_REGION, "s3", "aws4_request"):
        k = hmac.new(k, part.encode(), hashlib.sha256).digest()
    sig = hmac.new(k, sts.encode(), hashlib.sha256).hexdigest()
    headers["authorization"] = f"AWS4-HMAC-SHA256 Credential={S3_ACCESS_KEY}/{scope}, SignedHeaders={signed}, Signature={sig}"
    url = f"{u.scheme}://{host}{canon_uri}" + (f"?{canon_q}" if canon_q else "")
    req = urllib.request.Request(url, data=body if method in ("PUT", "POST") else None, method=method,
                                 headers={k: v for k, v in headers.items() if k != "host"})
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=_SSL or None) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except (urllib.error.URLError, OSError) as e:
        raise StorageError(f"object store unreachable: {e}") from None


def _obj_path(key: str) -> str:
    return f"/{S3_BUCKET}/{key}"


def put(key: str, data: bytes):
    s, b = _request("PUT", _obj_path(key), body=data)
    if s not in (200, 201):
        raise StorageError(f"PUT {s}: {b[:120]!r}")


def get(key: str) -> bytes:
    s, b = _request("GET", _obj_path(key))
    if s != 200:
        raise StorageError(f"GET {s}")
    return b


def delete(key: str):
    s, b = _request("DELETE", _obj_path(key))
    if s not in (200, 204, 404):
        raise StorageError(f"DELETE {s}")


def list_keys(prefix: str = "") -> Iterator[Tuple[str, int]]:
    token = None
    ns = "{http://s3.amazonaws.com/doc/2006-03-01/}"
    while True:
        q = {"list-type": "2", "prefix": prefix, "max-keys": "1000"}
        if token:
            q["continuation-token"] = token
        s, b = _request("GET", f"/{S3_BUCKET}", q)
        if s != 200:
            raise StorageError(f"LIST {s}")
        root = ET.fromstring(b)
        for c in root.iter(f"{ns}Contents"):
            yield c.findtext(f"{ns}Key"), int(c.findtext(f"{ns}Size") or 0)
        if (root.findtext(f"{ns}IsTruncated") or "false") != "true":
            return
        token = root.findtext(f"{ns}NextContinuationToken")


def ping() -> bool:
    try:
        s, _ = _request("GET", f"/{S3_BUCKET}", {"list-type": "2", "max-keys": "1"}, timeout=3)
        return s == 200
    except StorageError:
        return False


# ---------------------------------------------------------------- high level: DB row + encrypted object
def save_object(c, dorm_id: int, kind: str, mime: str, plain: bytes) -> int:
    """Encrypt + upload first, then insert the metadata row in the caller's transaction.
    If the transaction later rolls back, the orphan ciphertext is harmless (no row = never served)."""
    if not enabled():
        raise StorageError("object storage is not configured")
    key = f"d{int(dorm_id)}/{kind}/{secrets.token_urlsafe(18)}"
    key_id, blob = encrypt(key, plain)
    put(key, blob)
    return c.execute("INSERT INTO objects (dorm_id, kind, key, mime, size, sha256, key_id) VALUES (%s,%s,%s,%s,%s,%s,%s) "
                     "RETURNING id", (dorm_id, kind, key, mime, len(plain), hashlib.sha256(blob).hexdigest(), key_id)
                     ).fetchone()["id"]


def load_object(c, object_id: int) -> Tuple[str, bytes]:
    """RLS-checked: the row is only visible inside the right dorm's tenant_tx."""
    row = c.execute("SELECT key, mime, key_id, purged_at FROM objects WHERE id=%s", (object_id,)).fetchone()
    if not row or row["purged_at"]:
        raise LookupError("object not found")
    return row["mime"], decrypt(row["key_id"], row["key"], get(row["key"]))


def purge_object(c, object_id: int):
    row = c.execute("SELECT key FROM objects WHERE id=%s AND purged_at IS NULL", (object_id,)).fetchone()
    if row:
        delete(row["key"])
        c.execute("UPDATE objects SET purged_at=now() WHERE id=%s", (object_id,))
