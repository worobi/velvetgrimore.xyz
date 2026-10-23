#!/bin/sh
set -eu
app=$(docker ps --filter label=coolify.resourceName=velvet-grimore --format '{{.Names}}' | head -n 1)
if [ -z "$app" ]; then
  echo 'Velvet Grimoire is not running; backup failed' >&2
  exit 1
fi
docker exec "$app" node scripts/backup.js
