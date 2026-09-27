#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

LAN_IP="$(python3 -c 'import socket; s=socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.connect(("192.0.2.1", 80)); print(s.getsockname()[0]); s.close()' 2>/dev/null || true)"
if [[ "$LAN_IP" == "127."* ]]; then
  LAN_IP=""
fi

CANTALOUPE_JAR="${CANTALOUPE_JAR:-$PROJECT_ROOT/.local/cantaloupe/cantaloupe-5.0.7/cantaloupe-5.0.7.jar}"
ADMIN_ENV_FILE="$PROJECT_ROOT/backend/.env"
if [[ ! -x backend/.venv/bin/uvicorn || ! -d apps/admin/node_modules || ! -d apps/kiosk/node_modules ]]; then
  echo "Dependencies are missing. Run: bash scripts/setup.sh" >&2
  exit 1
fi
if [[ ! -f "$CANTALOUPE_JAR" ]]; then
  echo "Cantaloupe JAR not found at $CANTALOUPE_JAR. Run setup or set CANTALOUPE_JAR." >&2
  exit 1
fi

if [[ ! -f "$ADMIN_ENV_FILE" ]]; then
  ADMIN_PASSWORD="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
  umask 077
  printf 'TOUCHVIZ_ADMIN_PASSWORD=%s\nTOUCHVIZ_ADMIN_COOKIE_SECURE=false\n' "$ADMIN_PASSWORD" > "$ADMIN_ENV_FILE"
  echo "Created backend/.env with a new Admin password (saved locally, ignored by Git):"
  echo "  $ADMIN_PASSWORD"
  unset ADMIN_PASSWORD
  echo "Store this password securely; it will not be shown again."
fi

mkdir -p backend/data/iiif-cache
PIDS=()

cleanup() {
  trap - EXIT INT TERM
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  for pid in "${PIDS[@]}"; do
    wait "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

(
  cd backend
  set -a
  source .env
  set +a
  export TOUCHVIZ_LAN_IP="$LAN_IP"
  exec .venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
) &
PIDS+=("$!")

(
  cd apps/admin
  exec npm run dev -- --host 0.0.0.0 --port 5174
) &
PIDS+=("$!")

(
  cd apps/kiosk
  exec npm run dev -- --host 0.0.0.0 --port 5173
) &
PIDS+=("$!")

(
  export FILESYSTEMSOURCE_BASICLOOKUPSTRATEGY_PATH_PREFIX="$PROJECT_ROOT/backend/data/derived/"
  export FILESYSTEMCACHE_PATHNAME="$PROJECT_ROOT/backend/data/iiif-cache"
  exec java -Dcantaloupe.config="$PROJECT_ROOT/backend/iiif/cantaloupe.properties" -Xmx2g -jar "$CANTALOUPE_JAR"
) &
PIDS+=("$!")

echo "Services running in this terminal. Press Ctrl-C to stop all of them."
echo "Local URLs:"
echo "  Kiosk:     http://localhost:5173"
echo "  Admin:     http://localhost:5174"
echo "  Backend:   http://localhost:8000"
echo "  IIIF:      http://localhost:8182"
if [[ -n "$LAN_IP" ]]; then
  echo "Touchscreen/LAN URLs (devices on the same network):"
  echo "  Kiosk:     http://$LAN_IP:5173"
  echo "  Admin:     http://$LAN_IP:5174"
  echo "  Backend:   http://$LAN_IP:8000"
  echo "  IIIF:      http://$LAN_IP:8182"
else
  echo "LAN IP was not detected; use localhost URLs on this computer."
fi

while true; do
  for pid in "${PIDS[@]}"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      wait "$pid"
    fi
  done
  sleep 1
done
