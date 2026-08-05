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
    local standalone="${release_dir}/.next/standalone"

    [[ -d "${standalone}" ]] || return 0

    if [[ -d "${release_dir}/.next/static" ]]; then
        mkdir -p "${standalone}/.next/static"
        cp -r "${release_dir}/.next/static/." "${standalone}/.next/static/"
    fi

    if [[ -d "${release_dir}/public" ]]; then
        mkdir -p "${standalone}/public"
        cp -r "${release_dir}/public/." "${standalone}/public/"
    fi
}
