# security headers (shared by the lab config and the local test config)
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "no-referrer" always;
add_header Content-Security-Policy "default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'; form-action 'self'; base-uri 'none'" always;
add_header Strict-Transport-Security "max-age=604800" always;
# v2: the room page opens the camera to scan facility QR codes -> camera allowed for OUR origin only
add_header Permissions-Policy "camera=(self), microphone=(), geolocation=(), payment=()" always;
