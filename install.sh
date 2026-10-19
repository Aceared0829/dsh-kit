#!/bin/sh
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "node was not found on PATH." >&2
  exit 1
fi
exec node scripts/install.mjs "$@"
