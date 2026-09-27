#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is required. Install Python 3.10 or newer and rerun this script." >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "Node.js and npm are required. Install Node.js 20.19+ or 22.12+ and rerun this script." >&2
  exit 1
fi
if ! command -v java >/dev/null 2>&1; then
  echo "Java 17 or newer is required to run Cantaloupe." >&2
  exit 1
fi

JAVA_VERSION="$(java -version 2>&1 | sed -nE '1s/.*version "([0-9]+).*/\1/p')"
if [[ -z "$JAVA_VERSION" || "$JAVA_VERSION" -lt 17 ]]; then
  echo "Java 17 or newer is required to run Cantaloupe." >&2
  exit 1
fi

python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt
npm --prefix apps/admin ci
npm --prefix apps/kiosk ci

DEFAULT_CANTALOUPE_JAR="$PROJECT_ROOT/.local/cantaloupe/cantaloupe-5.0.7/cantaloupe-5.0.7.jar"
if [[ -n "${CANTALOUPE_JAR:-}" ]]; then
  if [[ ! -f "$CANTALOUPE_JAR" ]]; then
    echo "CANTALOUPE_JAR does not point to a file: $CANTALOUPE_JAR" >&2
    exit 1
  fi
elif [[ ! -f "$DEFAULT_CANTALOUPE_JAR" ]]; then
  if ! command -v curl >/dev/null 2>&1 || ! command -v unzip >/dev/null 2>&1; then
    echo "curl and unzip are required to download the Cantaloupe server." >&2
    exit 1
  fi
  mkdir -p .local/cantaloupe
  curl -fL --retry 3 \
    https://github.com/cantaloupe-project/cantaloupe/releases/download/v5.0.7/cantaloupe-5.0.7.zip \
    -o .local/cantaloupe/cantaloupe-5.0.7.zip
  unzip -q -o .local/cantaloupe/cantaloupe-5.0.7.zip -d .local/cantaloupe
  if [[ ! -f "$DEFAULT_CANTALOUPE_JAR" ]]; then
    echo "The Cantaloupe archive did not contain the expected 5.0.7 JAR." >&2
    exit 1
  fi
fi

echo "Setup complete. Start all services with: bash scripts/dev.sh"
