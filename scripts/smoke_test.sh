#!/usr/bin/env bash
# Smoke tests against a running Synkra OS instance. Not a substitute for
# real integration tests, but catches the "did the container actually come
# up correctly" class of failure before you consider a deploy done.
#
# Usage: PB_URL=http://localhost:8090 ./scripts/smoke_test.sh
set -uo pipefail

PB_URL="${PB_URL:-http://localhost:8090}"
FAIL=0

check() {
  local description="$1"
  local expected_status="$2"
  local actual_status="$3"
  if [ "$actual_status" == "$expected_status" ]; then
    echo "PASS: $description"
  else
    echo "FAIL: $description (expected $expected_status, got $actual_status)"
    FAIL=1
  fi
}

echo "== Smoke tests against ${PB_URL} =="

status=$(curl -s -o /dev/null -w "%{http_code}" "${PB_URL}/health")
check "GET /health returns 200" "200" "$status"

status=$(curl -s -o /dev/null -w "%{http_code}" "${PB_URL}/ready")
check "GET /ready returns 200 or 503 (not 500)" "200" "$status" || true

status=$(curl -s -o /dev/null -w "%{http_code}" "${PB_URL}/api/collections/customers/records")
check "GET customers without auth is rejected (400/401/403, not data)" "401" "$status"

status=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${PB_URL}/api/customers/does-not-exist/suspend" \
  -H "Content-Type: application/json" -d '{"reason":"test"}')
check "POST suspend without auth is rejected" "401" "$status"

status=$(curl -s -o /dev/null -w "%{http_code}" "${PB_URL}/")
check "GET / serves the frontend build" "200" "$status"

echo "=================================="
if [ "$FAIL" -eq 0 ]; then
  echo "All smoke tests passed."
  exit 0
else
  echo "One or more smoke tests failed. Do not consider this deploy done."
  exit 1
fi
