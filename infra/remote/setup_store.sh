#!/bin/sh
# Runs ON store-01 (Alpine). SeaweedFS = S3-compatible object store for photos, payment slips, fine evidence.
# Expects /tmp/dd/store.crt + store.key (signed by the DormDesk CA). env: S3_KEY S3_SECRET S3_BACKUP_KEY S3_BACKUP_SECRET
# Why SeaweedFS: MinIO's community edition was archived in 2026 (no more security fixes); SeaweedFS is
# Apache-2.0, one static binary, ~110 MB RAM idle — fits the 256 MB instance.
set -eu
VER=4.48
SHA=4a7d108384d044d95212d1342cdda9533fa55842c1c9b41f606ca3c8a9561124   # linux_amd64.tar.gz (matches upstream .md5)
D=/srv/seaweed
id weed >/dev/null 2>&1 || adduser -D -H -h $D -s /sbin/nologin weed
mkdir -p $D/data $D/tls
if [ ! -x $D/weed ] || ! $D/weed version 2>/dev/null | grep -q " $VER "; then
  wget -q -O /tmp/weed.tgz "https://github.com/seaweedfs/seaweedfs/releases/download/$VER/linux_amd64.tar.gz"
  echo "$SHA  /tmp/weed.tgz" | sha256sum -c - >/dev/null || { echo "CHECKSUM MISMATCH"; exit 1; }
  tar xzf /tmp/weed.tgz -C $D weed && rm /tmp/weed.tgz
fi
install -m 644 /tmp/dd/store.crt $D/tls/store.crt
install -m 600 -o weed /tmp/dd/store.key $D/tls/store.key
# two identities, least privilege: the API may read/write/list ONE bucket; backups may only read/list it
cat > $D/s3.json <<JSON
{"identities":[
 {"name":"dormdesk-api","credentials":[{"accessKey":"$S3_KEY","secretKey":"$S3_SECRET"}],"actions":["Read:dormdesk","Write:dormdesk","List:dormdesk"]},
 {"name":"dormdesk-backup","credentials":[{"accessKey":"$S3_BACKUP_KEY","secretKey":"$S3_BACKUP_SECRET"}],"actions":["Read:dormdesk","List:dormdesk"]}
]}
JSON
chmod 600 $D/s3.json; chown -R weed $D/data $D/s3.json $D/tls
cat > $D/start.sh <<'SH'
#!/bin/sh
# master/volume/filer listen on localhost only; S3 HTTPS on 10.0.2.155:8333 (firewall: API tier only).
# The plain-HTTP S3 port is moved to 8334 and is blocked by the default-deny firewall.
D=/srv/seaweed
pkill -f "$D/weed server" 2>/dev/null; sleep 1
touch /var/log/seaweed.log; chown weed /var/log/seaweed.log
cd $D && su weed -s /bin/sh -c "GOMEMLIMIT=180MiB nohup $D/weed server -dir=$D/data -ip=127.0.0.1 -ip.bind=127.0.0.1 \
  -s3 -s3.ip.bind=10.0.2.155 -s3.port=8334 -s3.port.https=8333 -s3.cert.file=$D/tls/store.crt -s3.key.file=$D/tls/store.key \
  -s3.config=$D/s3.json -s3.port.iceberg=0 -s3.port.lance=0 -master.volumeSizeLimitMB=256 -volume.max=8 -metricsPort=0 \
  >> /var/log/seaweed.log 2>&1 &"
sleep 5
for i in $(seq 1 20); do
  echo "s3.bucket.list" | $D/weed shell -master=127.0.0.1:9333 2>/dev/null | grep -q dormdesk && break
  echo "s3.bucket.create -name dormdesk" | $D/weed shell -master=127.0.0.1:9333 >/dev/null 2>&1; sleep 2
done
echo "s3.bucket.list" | $D/weed shell -master=127.0.0.1:9333 2>/dev/null | grep -q dormdesk && echo STORE_OK || echo STORE_NO_BUCKET
SH
chmod 700 $D/start.sh
mkdir -p /etc/dormdesk/start.d && ln -sf $D/start.sh /etc/dormdesk/start.d/50-seaweed   # boot hook starts it
rm -rf /tmp/dd
$D/start.sh
