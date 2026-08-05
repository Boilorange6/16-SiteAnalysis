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
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3002/site/login}"
KEEP_RELEASES="${KEEP_RELEASES:-3}"
RELEASE_STAMP="$(date +%Y%m%d-%H%M%S)"

echo "=== SiteAnalysis Deploy (release ${RELEASE_STAMP}) ==="

# ── 로컬 사전 검증 ── 서버에서 깨지는 것보다 여기서 막는 편이 싸다
if [[ "${SKIP_LOCAL_CHECKS:-0}" != "1" ]]; then
  echo "Running local checks (lint + tests)..."
  # CI와 동일한 결정론적 검증 — 청와대 산출물 QA는 아티팩트 의존이라 제외
  (cd "${LOCAL_DIR}" && npm run lint && npm run test:maintenance && npm run test:dataset && npm run test:rail)
fi

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
  --exclude="data/maintenance/raw" \
  --exclude="logs" \
  --exclude=".env" \
  --exclude=".env.local" \
  --exclude="*.log" \
  --exclude="*.stackdump" \
  --exclude="tsconfig.tsbuildinfo" \
  .

echo "Uploading to server..."
ssh "${SSH_OPTS[@]}" "${REMOTE_HOST}" "mkdir -p '${REMOTE_DIR}' '${REMOTE_DIR}/logs' '${REMOTE_DIR}/.cache' '${REMOTE_DIR}/releases'"
scp -i "${SSH_KEY}" /tmp/site-analysis-deploy.tar.gz "${REMOTE_HOST}:${REMOTE_DIR}/deploy.tar.gz"
scp -i "${SSH_KEY}" "${LOCAL_DIR}/deploy/release-lib.sh" "${REMOTE_HOST}:${REMOTE_DIR}/release-lib.sh"

echo "Building and deploying on server..."
ssh "${SSH_OPTS[@]}" "${REMOTE_HOST}" \
    "APP_NAME='${APP_NAME}' REMOTE_DIR='${REMOTE_DIR}' RELEASE_STAMP='${RELEASE_STAMP}' HEALTH_URL='${HEALTH_URL}' KEEP_RELEASES='${KEEP_RELEASES}' bash -s" <<'EOF'
set -Eeuo pipefail

source "${REMOTE_DIR}/release-lib.sh"

RELEASE_DIR="${REMOTE_DIR}/releases/${RELEASE_STAMP}"
mkdir -p "${RELEASE_DIR}"

# ── 새 릴리스 디렉터리에 전개 (운영 중인 current는 건드리지 않는다) ──
tar xzf "${REMOTE_DIR}/deploy.tar.gz" -C "${RELEASE_DIR}"
rm -f "${REMOTE_DIR}/deploy.tar.gz"

# 공유 자원 연결 — .env / .cache / logs는 릴리스 간에 유지된다
if [[ ! -f "${REMOTE_DIR}/.env" && -f "${RELEASE_DIR}/.env.example" ]]; then
    cp "${RELEASE_DIR}/.env.example" "${REMOTE_DIR}/.env"
    echo "INFO: .env created from .env.example — update API keys."
fi
ln -sfn "${REMOTE_DIR}/.env" "${RELEASE_DIR}/.env"
ln -sfn "${REMOTE_DIR}/logs" "${RELEASE_DIR}/logs"

# ── 빌드 (실패해도 current는 이전 릴리스를 가리킨 채 살아 있다) ──
cd "${RELEASE_DIR}"
if ! ( npm ci && npm run build ); then
    echo "ERROR: 빌드 실패 — 운영 릴리스는 그대로 유지됩니다." >&2
    rm -rf "${RELEASE_DIR}"
    exit 1
fi

cp -r .next/static .next/standalone/.next/static 2>/dev/null || true
cp -r public .next/standalone/public 2>/dev/null || true
rm -rf .next/standalone/.cache
ln -sfn "${REMOTE_DIR}/.cache" .next/standalone/.cache

if ! command -v pm2 >/dev/null 2>&1; then
    echo "pm2 is not installed." >&2
    exit 1
fi

start_app() {
    local root="$1"
    if pm2 describe "${APP_NAME}" >/dev/null 2>&1; then
        pm2 delete "${APP_NAME}" >/dev/null
    fi
    set -a; source "${REMOTE_DIR}/.env" 2>/dev/null || true; set +a
    PORT=3002 pm2 start "${root}/current/.next/standalone/server.js" \
      --name "${APP_NAME}" \
      --cwd "${root}/current" \
      -o "${REMOTE_DIR}/logs/out.log" \
      -e "${REMOTE_DIR}/logs/error.log" \
      --time >/dev/null
}

# ── 원자적 전환 → 헬스체크 → 실패 시 롤백 ──
release_activate "${REMOTE_DIR}" "${RELEASE_STAMP}"
start_app "${REMOTE_DIR}"

if health_check "${HEALTH_URL}" 12 5; then
    pm2 save >/dev/null
    release_prune "${REMOTE_DIR}" "${KEEP_RELEASES}"
    echo ""
    echo "=== Deployment complete (release ${RELEASE_STAMP}) ==="
    pm2 status "${APP_NAME}"
else
    echo "ERROR: 헬스체크 실패 — 이전 릴리스로 롤백합니다." >&2
    if release_rollback "${REMOTE_DIR}"; then
        start_app "${REMOTE_DIR}/current"
        if health_check "${HEALTH_URL}" 12 5; then
            echo "롤백 완료: 이전 릴리스로 서비스가 복구되었습니다." >&2
        else
            echo "치명적: 롤백 후에도 헬스체크 실패. 수동 확인 필요." >&2
        fi
    else
        echo "치명적: 롤백할 이전 릴리스가 없습니다. 수동 확인 필요." >&2
    fi
    rm -rf "${REMOTE_DIR}/releases/${RELEASE_STAMP}"
    exit 1
fi
EOF
