#!/usr/bin/env bash
# Run this once against a freshly migrated, empty PocketBase instance.
#
# Usage:
#   ./scripts/bootstrap.sh
#
# Requires: the pocketbase container/binary already running and reachable,
# BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD set (see .env.example),
# and `curl` + `jq` available locally.
set -euo pipefail

PB_URL="${PB_URL:-http://localhost:8090}"
ADMIN_EMAIL="${BOOTSTRAP_ADMIN_EMAIL:?Set BOOTSTRAP_ADMIN_EMAIL}"
ADMIN_PASSWORD="${BOOTSTRAP_ADMIN_PASSWORD:?Set BOOTSTRAP_ADMIN_PASSWORD}"

echo "==> Creating PocketBase superuser (dashboard access at ${PB_URL}/_/)"
# Requires running this from inside the container, or via `docker exec`:
#   docker exec -it <container> pocketbase superuser upsert "$ADMIN_EMAIL" "$ADMIN_PASSWORD"
echo "    Run manually if not already done:"
echo "    docker exec -it <container_name> pocketbase superuser upsert \"$ADMIN_EMAIL\" \"$ADMIN_PASSWORD\""
read -rp "    Press enter once the superuser exists to continue..."

echo "==> Authenticating as superuser to seed the first employee login"
AUTH_TOKEN=$(curl -sf -X POST "${PB_URL}/api/collections/_superusers/auth-with-password" \
  -H "Content-Type: application/json" \
  -d "{\"identity\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}" | jq -r '.token')

if [ -z "$AUTH_TOKEN" ] || [ "$AUTH_TOKEN" == "null" ]; then
  echo "Failed to authenticate as superuser. Check the credentials and that migrations have run." >&2
  exit 1
fi

echo "==> Looking up the seeded Super Administrator role"
ROLE_ID=$(curl -sf "${PB_URL}/api/collections/roles/records?filter=name='Super%20Administrator'" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" | jq -r '.items[0].id')

if [ -z "$ROLE_ID" ] || [ "$ROLE_ID" == "null" ]; then
  echo "Super Administrator role not found — did the seed migration (1735500002_users_and_seed.js) run?" >&2
  exit 1
fi

echo "==> Creating the first employee record"
EMPLOYEE_ID=$(curl -sf -X POST "${PB_URL}/api/collections/employees/records" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"full_name\":\"Synkra Admin\",\"email\":\"${ADMIN_EMAIL}\",\"role\":\"${ROLE_ID}\",\"status\":\"active\"}" \
  | jq -r '.id')

echo "==> Creating the login (users) record and linking it to the employee"
curl -sf -X POST "${PB_URL}/api/collections/users/records" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\",\"passwordConfirm\":\"${ADMIN_PASSWORD}\",\"employee\":\"${EMPLOYEE_ID}\"}" \
  > /dev/null

echo "==> Done. You can now log in to Synkra OS at ${PB_URL}/ with:"
echo "    Email:    ${ADMIN_EMAIL}"
echo "    Password: (the BOOTSTRAP_ADMIN_PASSWORD you set)"
