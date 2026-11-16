#!/usr/bin/env bash
set -euo pipefail
# Public releases are migrated with the separate owner credential before deployment.
# The existing private profile retains its startup migration behavior.
if [[ "${PUBLIC_DEMO:-false}" != true ]]; then
  env -u PUBLIC_DEMO_CLEANUP_DATABASE_URL npm run db:migrate
fi
# Configuration needs only the ingress peer list, never database or API credentials.
env -i PATH="$PATH" RENDER_TRUSTED_PROXY_CIDRS="${RENDER_TRUSTED_PROXY_CIDRS:-}" \
  node --import tsx deploy/render-configure.mjs
exec node deploy/render-supervisor.mjs
