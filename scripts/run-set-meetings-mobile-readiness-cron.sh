#!/bin/zsh
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
export WINDOW_DAYS="${WINDOW_DAYS:-9}"
export READ_ONLY="${READ_ONLY:-1}"

cd "${PROJECT_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"

mkdir -p logs

timestamp="$(date '+%Y-%m-%d %H:%M:%S %z')"
{
  printf '[%s] starting set meetings mobile readiness guard\n' "$timestamp"
  npm run verify:set-meetings-mobile-readiness
  printf '[%s] completed set meetings mobile readiness guard\n' "$(date '+%Y-%m-%d %H:%M:%S %z')"
} >> logs/set-meetings-mobile-readiness-cron.log 2>&1
