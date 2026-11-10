#!/bin/sh
# Starts CLUB JOIA 300 (white edition) from this folder. Reads settings from ./.env.
set -e
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "Missing .env — copy .env.example to .env and fill it in first." >&2
  exit 1
fi

set -a
. ./.env
set +a

for v in DATABASE_URL AUTH_SECRET QR_SIGNING_SECRET NEXT_PUBLIC_APP_URL; do
  eval "val=\${$v:-}"
  if [ -z "$val" ]; then echo "Missing $v in .env" >&2; exit 1; fi
done

export NODE_ENV=production
export PORT="${PORT:-3000}"
# server.js listens on $HOSTNAME. Many Linux shells pre-set HOSTNAME to the machine name,
# so it is set explicitly here. Default: only reachable through the reverse proxy on this server.
export HOSTNAME="${BIND_ADDRESS:-127.0.0.1}"

exec node server.js
