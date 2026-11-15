#!/usr/bin/env bash
set -euo pipefail
api_pid=
nginx_pid=
shutdown() {
  trap - EXIT INT TERM
  [[ -z "$nginx_pid" ]] || kill -TERM "$nginx_pid" 2>/dev/null || true
  [[ -z "$api_pid" ]] || kill -TERM "$api_pid" 2>/dev/null || true
  wait || true
}
trap shutdown EXIT INT TERM
# Public releases are migrated with the separate owner credential before deployment.
# The existing private profile retains its startup migration behavior.
if [[ "${PUBLIC_DEMO:-false}" != true ]]; then npm run db:migrate; fi
node --import tsx deploy/render-configure.mjs
PORT=3000 TSX_TSCONFIG_PATH=/app/apps/api/tsconfig.json node --import tsx apps/api/src/index.ts &
api_pid=$!
nginx -g 'daemon off;' &
nginx_pid=$!
wait -n "$api_pid" "$nginx_pid"
# Any unexpected child exit should trigger Render recovery, even exit status zero.
exit 1
