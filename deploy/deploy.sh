#!/usr/bin/env bash

set -Eeuo pipefail

SERVER_IP="43.200.41.165"
SSH_KEY="${SSH_KEY:-D:/V-coding/LightsailDefaultKey-ap-northeast-2.pem}"
REMOTE_USER="bitnami"
REMOTE_DIR="/home/bitnami/site-analysis"
LOCAL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

APP_NAME="site-analysis"
REMOTE_HOST="${REMOTE_USER}@${SERVER_IP}"
SSH_OPTS=(-i "${SSH_KEY}" -o StrictHostKeyChecking=accept-new)

echo "=== SiteAnalysis Deploy ==="

# ── Upload via tar (rsync not available on Windows) ──
echo "Packaging project..."
cd "${LOCAL_DIR}"
tar czf /tmp/site-analysis-deploy.tar.gz \
  --exclude=".git" \
  --exclude=".next" \
  --exclude="node_modules" \
  --exclude=".cache" \
  --exclude=".claude" \
  --exclude=".climpire" \
  --exclude=".climpire-worktrees" \
  --exclude="output" \
  --exclude="qa" \
  --exclude="docs" \
  --exclude="logs" \
  --exclude=".env" \
  --exclude="*.log" \
  --exclude="*.stackdump" \
  --exclude="tsconfig.tsbuildinfo" \
  .

echo "Uploading to server..."
ssh "${SSH_OPTS[@]}" "${REMOTE_HOST}" "mkdir -p '${REMOTE_DIR}' '${REMOTE_DIR}/logs' '${REMOTE_DIR}/.cache'"
scp -i "${SSH_KEY}" /tmp/site-analysis-deploy.tar.gz "${REMOTE_HOST}:${REMOTE_DIR}/deploy.tar.gz"

echo "Building and deploying on server..."
ssh "${SSH_OPTS[@]}" "${REMOTE_HOST}" \
    "APP_NAME='${APP_NAME}' REMOTE_DIR='${REMOTE_DIR}' bash -s" <<'EOF'
set -Eeuo pipefail

cd "${REMOTE_DIR}"

# Extract (preserve .cache and .env)
tar xzf deploy.tar.gz
rm deploy.tar.gz

# Setup .env if not present
if [[ ! -f ".env" && -f ".env.example" ]]; then
    cp .env.example .env
    echo "INFO: .env created from .env.example — update Naver API keys."
fi

# Install dependencies and build
npm ci
npm run build

# Copy static files for standalone mode
cp -r .next/static .next/standalone/.next/static 2>/dev/null || true
cp -r public .next/standalone/public 2>/dev/null || true

# Symlink .cache into standalone (server resolves paths relative to standalone dir)
rm -rf .next/standalone/.cache
ln -sf "${REMOTE_DIR}/.cache" .next/standalone/.cache

# PM2 start/restart
if ! command -v pm2 >/dev/null 2>&1; then
    echo "pm2 is not installed." >&2
    exit 1
fi

if pm2 describe "${APP_NAME}" >/dev/null 2>&1; then
    pm2 delete "${APP_NAME}"
fi

# Load .env vars for PM2 process environment
set -a; source "${REMOTE_DIR}/.env" 2>/dev/null || true; set +a

PORT=3002 pm2 start .next/standalone/server.js \
  --name "${APP_NAME}" \
  --cwd "${REMOTE_DIR}" \
  -o "${REMOTE_DIR}/logs/out.log" \
  -e "${REMOTE_DIR}/logs/error.log" \
  --time

pm2 save

echo ""
echo "=== Deployment complete ==="
echo "Site: http://43.200.41.165/site/"
pm2 status "${APP_NAME}"
EOF

echo "Deployment completed."
echo "URL: http://43.200.41.165/site/"
