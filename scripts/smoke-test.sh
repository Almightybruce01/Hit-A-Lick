#!/usr/bin/env bash
# Post-deploy smoke checks (no auth required).
set -euo pipefail

# Override for staging: export HITALICK_API_BASE=https://your-run-url
BASE="${HITALICK_API_BASE:-https://api-lifnvql5aa-uc.a.run.app}"
BASE="${BASE%/}"

echo "==> Smoke test against: $BASE"
echo ""

fail=0
check() {
  local name="$1" url="$2"
  local code
  code=$(curl -sS -o /tmp/hitalick-smoke.json -w "%{http_code}" "$url" || echo "000")
  if [[ "$code" =~ ^2 ]]; then
    echo "  OK ($code) $name"
  else
    echo "  FAIL ($code) $name"
    fail=1
  fi
}

check "GET /health" "$BASE/health"
check "GET /api/health" "$BASE/api/health"
check "GET /api/status" "$BASE/api/status"
check "GET /ops/dashboard" "$BASE/ops/dashboard"

echo ""
if [[ "$fail" -ne 0 ]]; then
  echo "One or more checks failed. Inspect URLs and Firebase logs."
  exit 1
fi
echo "All checks passed."
exit 0
