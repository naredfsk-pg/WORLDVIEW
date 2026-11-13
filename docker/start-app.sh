#!/bin/sh
# WORLDVIEW app container start (ARCHITECTURE §17): apply migrations, mirror the 30 Academy
# lessons into the database (never the demo news: db:seed is dev-only), then serve.
# `exec` hands PID over to node, so SIGTERM from `docker compose stop` (through the init process,
# compose `init: true`) reaches adapter-node, which stops accepting requests and drains.
set -eu

# Database files private to the node user (600 files in a 700 directory), also on a volume
# created before the image set /data to 700.
umask 077
chmod 700 /data 2>/dev/null || true

node build/scripts/migrate.js
node build/scripts/academy-sync.js
exec node build
