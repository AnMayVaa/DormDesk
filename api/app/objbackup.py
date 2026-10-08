"""Object-store backup / restore CLI (run on an API server, which is the only tier that can reach store-01).

  python -m app.objbackup dump    > objects.tar     tar = manifest.json + every object exactly as stored
  python -m app.objbackup verify  < objects.tar     check every blob against the manifest's sha256
  python -m app.objbackup restore < objects.tar     PUT back objects that are missing from the bucket

Objects are already AES-256-GCM ciphertext (the keys live only in the API's .env / secrets.env), so a stolen
backup reveals nothing. tools/backup.sh runs `dump` with the READ-ONLY backup identity (it cannot write or
delete), streams the tar to the laptop and encrypts it there a second time with the backup passphrase.
"""
import hashlib
import io
import json
import sys
import tarfile
import time


def dump(out=None):
    from . import storage   # imported lazily: `verify` also runs on the laptop without the API's dependencies
    out = out or sys.stdout.buffer
    manifest, n = [], 0
    with tarfile.open(fileobj=out, mode="w|") as tar:
        for key, size in storage.list_keys(""):
            blob = storage.get(key)
            info = tarfile.TarInfo("objects/" + key)
            info.size, info.mtime = len(blob), int(time.time())
            tar.addfile(info, io.BytesIO(blob))
            manifest.append({"key": key, "size": len(blob), "sha256": hashlib.sha256(blob).hexdigest()})
            n += 1
        m = json.dumps({"bucket": storage.S3_BUCKET, "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                        "count": n, "objects": manifest}, indent=1).encode()
        info = tarfile.TarInfo("manifest.json")
        info.size, info.mtime = len(m), int(time.time())
        tar.addfile(info, io.BytesIO(m))
    print(f"objects: {n}", file=sys.stderr)


def _read(inp):
    blobs, manifest = {}, None
    with tarfile.open(fileobj=inp, mode="r|") as tar:
        for m in tar:
            data = tar.extractfile(m).read() if m.isfile() else b""
            if m.name == "manifest.json":
                manifest = json.loads(data)
            elif m.name.startswith("objects/"):
                blobs[m.name[8:]] = data
    if manifest is None:
        raise SystemExit("manifest.json missing")
    return manifest, blobs


def verify(inp=None) -> bool:
    manifest, blobs = _read(inp or sys.stdin.buffer)
    bad = [o["key"] for o in manifest["objects"]
           if hashlib.sha256(blobs.get(o["key"], b"")).hexdigest() != o["sha256"]]
    print(f"manifest {manifest['count']} objects, tar {len(blobs)} blobs, mismatches {len(bad)}")
    return not bad and len(blobs) == manifest["count"]


def restore(inp=None):
    from . import storage
    manifest, blobs = _read(inp or sys.stdin.buffer)
    have = {k for k, _ in storage.list_keys("")}
    put = 0
    for o in manifest["objects"]:
        if o["key"] not in have:
            storage.put(o["key"], blobs[o["key"]])
            put += 1
    print(f"restored {put} missing objects ({len(have)} already present)")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "dump":
        dump()
    elif cmd == "verify":
        sys.exit(0 if verify() else 1)
    elif cmd == "restore":
        restore()
    else:
        raise SystemExit(__doc__)
