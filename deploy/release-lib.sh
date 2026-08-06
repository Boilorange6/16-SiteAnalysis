#!/usr/bin/env bash
# 릴리스 관리 함수 모음. deploy.sh가 source해서 쓰고, qa/test-release-manager.mjs가 검증한다.
# 구조: <root>/releases/<타임스탬프>/ 에 배포하고 <root>/current 심볼릭 링크를 원자적으로 교체한다.

# 지정 릴리스를 current로 활성화하고, 직전 릴리스를 .previous에 기록한다.
release_activate() {
  local root="$1" stamp="$2"
  local releases="${root}/releases"
  local target="${releases}/${stamp}"
  [[ -d "${target}" ]] || { echo "release_activate: ${target} 없음" >&2; return 1; }

  local current="${root}/current"
  if [[ -L "${current}" ]]; then
    local prev
    prev="$(basename "$(readlink "${current}")")"
    [[ "${prev}" != "${stamp}" ]] && printf '%s\n' "${prev}" > "${releases}/.previous"
  fi

  # 임시 링크 후 mv — 교체 순간에 current가 없는 창을 만들지 않는다
  ln -sfn "${target}" "${current}.tmp"
  mv -Tf "${current}.tmp" "${current}" 2>/dev/null || { rm -rf "${current}"; mv "${current}.tmp" "${current}"; }
}

# .previous에 기록된 직전 릴리스로 되돌린다. 기록이 없거나 디렉터리가 사라졌으면 실패한다.
release_rollback() {
  local root="$1"
  local releases="${root}/releases"
  local previous_file="${releases}/.previous"
  [[ -f "${previous_file}" ]] || { echo "release_rollback: 이전 릴리스 기록 없음" >&2; return 1; }
  local prev
  prev="$(cat "${previous_file}")"
  [[ -n "${prev}" && -d "${releases}/${prev}" ]] || { echo "release_rollback: 이전 릴리스 ${prev} 없음" >&2; return 1; }
  release_activate "${root}" "${prev}"
}

# 최신 keep개만 남기고 나머지를 지운다. current와 .previous가 가리키는 릴리스는 항상 보호한다.
release_prune() {
  local root="$1" keep="${2:-3}"
  local releases="${root}/releases"
  [[ -d "${releases}" ]] || return 0

  local protected=()
  [[ -L "${root}/current" ]] && protected+=("$(basename "$(readlink "${root}/current")")")
  [[ -f "${releases}/.previous" ]] && protected+=("$(cat "${releases}/.previous")")

  local all=()
  while IFS= read -r name; do
    [[ -n "${name}" ]] && all+=("${name}")
  done < <(find "${releases}" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null | sort -r)

  local kept=0
  local name
  for name in "${all[@]}"; do
    if [[ ${kept} -lt ${keep} ]]; then
      kept=$((kept + 1))
      continue
    fi
    local is_protected=0 guard
    for guard in "${protected[@]+"${protected[@]}"}"; do
      [[ "${name}" == "${guard}" ]] && is_protected=1
    done
    [[ ${is_protected} -eq 1 ]] || rm -rf "${releases:?}/${name}"
  done
}

# HTTP 200을 받을 때까지 재시도한다. 소진하면 1을 반환한다.
# 사용: health_check <url> [retries] [sleep_seconds]
health_check() {
  local url="$1" retries="${2:-10}" delay="${3:-3}"
  local attempt=0 code
  while [[ ${attempt} -lt ${retries} ]]; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${url}" || echo 000)"
    if [[ "${code}" == "200" || "${code}" == "301" || "${code}" == "302" || "${code}" == "308" ]]; then
      return 0
    fi
    attempt=$((attempt + 1))
    [[ ${attempt} -lt ${retries} ]] && sleep "${delay}"
  done
  echo "health_check: ${url} 응답 ${code} (재시도 ${retries}회 소진)" >&2
  return 1
}

# standalone 산출물의 server.js 실제 경로를 찾는다.
# Next.js가 워크스페이스 루트를 상위 디렉터리로 추론하면 산출물이
# .next/standalone/<프로젝트 상대경로>/server.js 로 중첩된다.
# (2026-08-01 운영 장애: releases/<stamp> 안에서 빌드해 중첩이 발생)
resolve_server_entry() {
  local release_dir="$1"
  local standalone="${release_dir}/.next/standalone"
  [[ -d "${standalone}" ]] || { echo "resolve_server_entry: ${standalone} 없음" >&2; return 1; }

  if [[ -f "${standalone}/server.js" ]]; then
    printf '%s\n' "${standalone}/server.js"
    return 0
  fi
  local found
  found="$(find "${standalone}" -maxdepth 6 -name server.js -type f 2>/dev/null | head -1)"
  [[ -n "${found}" ]] || { echo "resolve_server_entry: server.js를 찾지 못했습니다" >&2; return 1; }
  printf '%s\n' "${found}"
}

# 빌드 산출물을 standalone 디렉터리에 올린다.
#
# `cp -r public <dest>/public`은 dest/public이 이미 있으면 public/public 으로 중첩된다.
# Next standalone이 public 일부를 미리 만들어 두기 때문에 실제로 그렇게 됐고,
# 운영에서 폰트·assets가 404가 났다. 항상 "내용"을 복사한다.
stage_standalone_assets() {
    local release_dir="$1"
    local shared_dir="${2:-}"
    local standalone="${release_dir}/.next/standalone"

    [[ -d "${standalone}" ]] || return 0

    # Next standalone 빌드는 릴리스의 .env를 "복사"해 넣는다. 릴리스의 .env가
    # 공유 .env로의 심볼릭 링크여도 복사본은 그 시점 값으로 굳는다. 그래서
    # 운영 .env에 키를 추가하고 재시작해도 앱은 옛 값을 계속 읽었다
    # (2026-08-05 SEOUL_OPEN_API_KEY: 파일엔 있는데 "not configured").
    # .cache와 같은 이유로 링크로 바꿔 둔다.
    if [[ -n "${shared_dir}" && -f "${shared_dir}/.env" ]]; then
        rm -f "${standalone}/.env"
        ln -sfn "${shared_dir}/.env" "${standalone}/.env"
    fi

    if [[ -d "${release_dir}/.next/static" ]]; then
        mkdir -p "${standalone}/.next/static"
        cp -r "${release_dir}/.next/static/." "${standalone}/.next/static/"
    fi

    if [[ -d "${release_dir}/public" ]]; then
        mkdir -p "${standalone}/public"
        cp -r "${release_dir}/public/." "${standalone}/public/"
    fi
}

# 정비사업 산출물을 공유 경로로 링크한다.
#
# boundaries.geojson / seoul-cleanup.json은 크론이 주기적으로 다시 만든다.
# 릴리스마다 사본을 두면 크론의 갱신이 앱에 영원히 닿지 않는다 — 실제로 운영에서
# 공유 루트는 7/30, 앱이 읽는 릴리스는 8/5로 갈라져 있었고 아무도 몰랐다.
# .env와 같은 이유다: 런타임에 바뀌는 것은 빌드 산출물 안에 복사해 두지 않는다.
link_shared_artifacts() {
    local release_dir="$1"
    local shared_dir="$2"
    local relative="data/maintenance/processed"

    [[ -n "${shared_dir}" ]] || return 0

    mkdir -p "${shared_dir}/${relative}"
    mkdir -p "$(dirname "${release_dir}/${relative}")"
    rm -rf "${release_dir}/${relative}"
    ln -sfn "${shared_dir}/${relative}" "${release_dir}/${relative}"
}

# 배포 가능한 상태인지 확인하고 커밋 SHA를 출력한다.
#
# deploy.sh는 작업 트리를 통째로 tar한다. 편하지만 릴리스와 커밋의 연결이 끊긴다 —
# "release 20260805-225153에 뭐가 들었나"에 저장소만 보고 답할 수 없다.
# 2026-08-05에는 운영보다 뒤처진 브랜치를 배포할 뻔한 것을 배포 직전에 사람이 겨우
# 잡았다. 다음번엔 못 잡는다. 그래서 기계가 본다.
#
#   1. 추적 파일에 미커밋 변경이 있으면 거부 (미추적 파일은 봐준다 — 스크린샷·임시
#      파일까지 막으면 게이트가 늘 걸리고, 늘 걸리는 게이트는 결국 우회된다)
#   2. HEAD가 원격에 없으면 거부 (원격에 없는 커밋은 그 릴리스를 재현할 수 없다)
#
# ALLOW_DIRTY_DEPLOY=1로 우회할 수 있다. 우회구가 없으면 급할 때 이 호출을 주석
# 처리하게 되고, 그렇게 사라진 게이트는 돌아오지 않는다.
assert_deployable() {
    local dir="${1:-.}"
    local sha
    sha="$(git -C "${dir}" rev-parse HEAD 2>/dev/null)" || {
        echo "git 저장소가 아닙니다: ${dir}" >&2
        return 1
    }

    local dirty=""
    git -C "${dir}" diff --quiet || dirty="yes"
    git -C "${dir}" diff --cached --quiet || dirty="yes"

    local pushed=""
    if git -C "${dir}" branch -r --contains HEAD 2>/dev/null | grep -q .; then
        pushed="yes"
    fi

    if [[ -n "${ALLOW_DIRTY_DEPLOY:-}" ]]; then
        if [[ -n "${dirty}" || -z "${pushed}" ]]; then
            echo "경고: ALLOW_DIRTY_DEPLOY로 배포 게이트를 우회합니다." >&2
            [[ -n "${dirty}" ]] && echo "경고:   - 커밋되지 않은 변경이 있습니다" >&2
            [[ -z "${pushed}" ]] && echo "경고:   - 이 커밋은 원격에 없습니다" >&2
            echo "경고: 이 릴리스는 커밋으로 재현할 수 없습니다." >&2
        fi
        echo "${sha}"
        return 0
    fi

    if [[ -n "${dirty}" ]]; then
        echo "커밋되지 않은 변경이 있습니다. 배포는 커밋된 상태에서만 합니다." >&2
        git -C "${dir}" diff --name-only HEAD | sed 's/^/  /' >&2
        echo "  → 커밋 후 다시 실행하거나, 비상시 ALLOW_DIRTY_DEPLOY=1을 붙이세요." >&2
        return 1
    fi

    if [[ -z "${pushed}" ]]; then
        echo "푸시되지 않은 커밋입니다: ${sha:0:7}" >&2
        echo "  원격에 없는 커밋은 나중에 이 릴리스를 재현할 수 없습니다." >&2
        echo "  → git push 후 다시 실행하거나, 비상시 ALLOW_DIRTY_DEPLOY=1을 붙이세요." >&2
        return 1
    fi

    echo "${sha}"
}

# 커밋된 트리를 배포 아카이브로 만든다.
#
# 예전에는 작업 트리를 tar하고 제외 목록으로 걸러냈다. 그 방식은 두더지잡기라
# 반드시 샌다 — 실제로 API 키가 든 `.env.local.bak-20260805-203125`가 제외 목록
# (`.env.local` 정확히 일치)을 빠져나가 서버로 갈 뻔했다. `.omo/` 138MB도 함께.
#
# HEAD를 아카이브하면 "배포된 것 = 커밋된 것"이 정의로 성립한다. 미추적 파일은
# 존재 자체가 배포와 무관해지므로 제외 목록을 관리할 필요도 없다.
# 서버에 필요 없는 경로는 .gitattributes의 export-ignore로 뺀다.
package_release() {
    local dir="$1"
    local output="$2"
    git -C "${dir}" archive --format=tar.gz -o "${output}" HEAD
}
