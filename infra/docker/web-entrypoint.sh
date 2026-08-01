#!/bin/sh
set -eu

node /app/web-runtime-url.mjs >/dev/null
exec node apps/web/server.js
