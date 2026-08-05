#!/usr/bin/env bash
#
# 적재 배치 실행기 (크론용).
#
# 크론은 셸 환경이 거의 비어 있고 cwd도 다르다. 여기서 세 가지를 보장한다.
#   1. 항상 current 릴리스에서 실행 — 옛 체크아웃에서 돌면 산출물이 앱에 닿지 않는다
#   2. 공유 .env 로드 — 키 없이 조용히 0건 적재하는 것을 막는다
#   3. 중복 실행 방지 — 적재가 길어져 다음 크론과 겹치면 상류를 두 배로 때린다
#
# 사용법: ingest-cron.sh <planned|ledger> [추가 인자...]
set -Eeuo pipefail

ROOT="${SITE_ANALYSIS_ROOT:-/home/bitnami/site-analysis}"
TASK="${1:-}"
shift || true

if [[ -z "${TASK}" ]]; then
    echo "사용법: $(basename "$0") <planned|ledger> [인자...]" >&2
    exit 2
fi

CURRENT="${ROOT}/current"
[[ -d "${CURRENT}" ]] || { echo "릴리스를 찾을 수 없습니다: ${CURRENT}" >&2; exit 1; }

LOG_DIR="${ROOT}/logs"
mkdir -p "${LOG_DIR}"
LOG_FILE="${LOG_DIR}/ingest-${TASK}.log"

LOCK_FILE="${ROOT}/.ingest-${TASK}.lock"
exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
    echo "[$(date -u +%FT%TZ)] ${TASK} 이미 실행 중 — 건너뜁니다" >> "${LOG_FILE}"
    exit 0
fi

cd "${CURRENT}"
set -a
# shellcheck disable=SC1091
. "${ROOT}/.env"
set +a

case "${TASK}" in
    planned) SCRIPT="src/scripts/ingest-planned-housing.mjs" ;;
    ledger)  SCRIPT="src/scripts/ingest-ledger.mjs" ;;
    *) echo "알 수 없는 작업: ${TASK}" >&2; exit 2 ;;
esac

{
    echo "[$(date -u +%FT%TZ)] ${TASK} 시작 (release $(basename "$(readlink -f "${CURRENT}")"))"
    if npx tsx "${SCRIPT}" "$@"; then
        echo "[$(date -u +%FT%TZ)] ${TASK} 성공"
    else
        status=$?
        echo "[$(date -u +%FT%TZ)] ${TASK} 실패 (exit ${status})"
        exit "${status}"
    fi
} >> "${LOG_FILE}" 2>&1
