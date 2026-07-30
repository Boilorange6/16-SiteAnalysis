#!/usr/bin/env node
// 서울 정비사업 정보몽땅(cleanup.seoul.go.kr) 사업장검색을 수집해
// data/maintenance/processed/seoul-cleanup.json 산출물을 생성한다.
// 실패·검증 미통과 시 기존 산출물을 보존한다(임시 파일 → rename).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";

import {
  SEOUL_CLEANUP_LIST_URL,
  parseSeoulCleanupListPage,
  seoulCleanupArtifactSchema,
} from "../lib/server/maintenance/seoul-cleanup.ts";

const MAX_PAGES = 300;
const PAGE_DELAY_MS = 250;
const GEOCODE_DELAY_MS = 80;
const MIN_RECORD_COUNT = 500;
const MAX_COUNT_DRIFT_RATIO = 0.2;
const NCP_GEOCODE_URL = "https://maps.apigw.ntruss.com/map-geocode/v2/geocode";

const acceptLargeChange = process.argv.includes("--accept-large-change");
const outputPath = join(process.cwd(), "data/maintenance/processed/seoul-cleanup.json");
const metaPath = join(process.cwd(), "data/maintenance/processed/seoul-cleanup.meta.json");

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function fetchPage(cpage) {
  const response = await fetch(SEOUL_CLEANUP_LIST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `cpage=${cpage}`,
  });
  if (!response.ok) throw new Error(`정보몽땅 페이지 ${cpage} 요청 실패: HTTP ${response.status}`);
  // 서버가 클라이언트에 따라 UTF-8 또는 EUC-KR로 응답한다.
  // UTF-8 우선 디코딩 후 대체문자(U+FFFD)가 나오면 EUC-KR로 재시도한다.
  const buffer = await response.arrayBuffer();
  const utf8 = new TextDecoder("utf-8").decode(buffer);
  return utf8.includes("�") ? new TextDecoder("euc-kr").decode(buffer) : utf8;
}

async function crawlRows() {
  const rows = [];
  const seen = new Set();
  for (let cpage = 1; cpage <= MAX_PAGES; cpage += 1) {
    const pageRows = parseSeoulCleanupListPage(await fetchPage(cpage));
    if (!pageRows.length) break;
    let added = 0;
    for (const row of pageRows) {
      if (seen.has(row.no)) continue;
      seen.add(row.no);
      rows.push(row);
      added += 1;
    }
    if (!added) break; // 마지막 페이지 이후 같은 내용 반복 방어
    if (cpage % 20 === 0) console.log(`  ${cpage}페이지 · 누적 ${rows.length}건`);
    await sleep(PAGE_DELAY_MS);
  }
  return rows;
}

function previousArtifact() {
  if (!existsSync(outputPath)) return null;
  try {
    return seoulCleanupArtifactSchema.parse(JSON.parse(readFileSync(outputPath, "utf8")));
  } catch {
    return null;
  }
}

function previousCoordinates(artifact) {
  const map = new Map();
  for (const row of artifact?.records ?? []) {
    if (Number.isFinite(row.lat) && Number.isFinite(row.lng)) {
      map.set(`${row.sigungu}|${row.address}`, { lat: row.lat, lng: row.lng });
    }
  }
  return map;
}

function geocoder() {
  const id = process.env.NCP_CLIENT_ID?.trim();
  const secret = process.env.NCP_CLIENT_SECRET?.trim();
  if (!id || !secret) return null;
  return async (query) => {
    const response = await fetch(`${NCP_GEOCODE_URL}?query=${encodeURIComponent(query)}`, {
      headers: { "X-NCP-APIGW-API-KEY-ID": id, "X-NCP-APIGW-API-KEY": secret },
    });
    if (!response.ok) return null;
    const root = await response.json();
    const first = Array.isArray(root?.addresses) ? root.addresses[0] : null;
    const lat = Number(first?.y);
    const lng = Number(first?.x);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  };
}

async function geocodeRows(rows, cache) {
  const geocode = geocoder();
  if (!geocode) {
    console.warn("NCP_CLIENT_ID/SECRET 미설정 — 좌표 없이 저장합니다(공간조인 비활성).");
    return rows;
  }
  const result = [];
  let fresh = 0;
  for (const row of rows) {
    if (!row.address) {
      result.push(row);
      continue;
    }
    const cacheKey = `${row.sigungu}|${row.address}`;
    let coordinate = cache.get(cacheKey) ?? null;
    if (!coordinate) {
      const query = `서울특별시 ${row.sigungu} ${row.address}`.replaceAll(/\s+/g, " ").trim();
      try {
        coordinate = await geocode(query);
      } catch {
        coordinate = null;
      }
      if (coordinate) {
        cache.set(cacheKey, coordinate);
        fresh += 1;
      }
      await sleep(GEOCODE_DELAY_MS);
    }
    result.push(coordinate ? { ...row, lat: coordinate.lat, lng: coordinate.lng } : row);
  }
  console.log(`지오코딩 신규 ${fresh}건 (캐시 재사용 포함 좌표 보유 ${result.filter((row) => Number.isFinite(row.lat)).length}건)`);
  return result;
}

function validate(rows, previous) {
  const problems = [];
  if (rows.length < MIN_RECORD_COUNT) problems.push(`수집 건수 ${rows.length}건 < 최소 ${MIN_RECORD_COUNT}건`);
  const missingStage = rows.filter((row) => !row.stage_text).length;
  if (missingStage > 0) problems.push(`진행단계 누락 ${missingStage}건`);
  const hangulStage = rows.filter((row) => /[가-힣]/.test(row.stage_text)).length;
  if (hangulStage / Math.max(rows.length, 1) < 0.9) {
    problems.push(`진행단계 한글 판독률 ${(hangulStage / rows.length * 100).toFixed(1)}% < 90% — 인코딩 오류 의심`);
  }
  const withAddress = rows.filter((row) => row.address).length;
  if (withAddress / Math.max(rows.length, 1) < 0.9) problems.push(`대표지번 보유율 ${(withAddress / rows.length * 100).toFixed(1)}% < 90%`);
  if (previous && !acceptLargeChange) {
    const drift = Math.abs(rows.length - previous.record_count) / previous.record_count;
    if (drift > MAX_COUNT_DRIFT_RATIO) {
      problems.push(`직전 산출물 대비 건수 변동 ${(drift * 100).toFixed(1)}% > ${MAX_COUNT_DRIFT_RATIO * 100}% — 사이트 개편/파서 손상 의심. 확인 후 --accept-large-change로 재실행`);
    }
  }
  return problems;
}

async function main() {
  console.log("정보몽땅 사업장검색 수집 시작…");
  const rows = await crawlRows();
  console.log(`수집 완료: ${rows.length}건`);
  const previous = previousArtifact();
  const problems = validate(rows, previous);
  if (problems.length) {
    console.error("검증 실패 — 기존 산출물을 유지합니다:");
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }
  const geocoded = await geocodeRows(rows, previousCoordinates(previous));
  const artifact = {
    schema_version: 1,
    source_url: SEOUL_CLEANUP_LIST_URL,
    retrieved_at: new Date().toISOString(),
    record_count: geocoded.length,
    records: geocoded,
  };
  seoulCleanupArtifactSchema.parse(artifact);
  mkdirSync(dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(artifact, null, 1)}\n`, "utf8");
  renameSync(temporaryPath, outputPath);
  const locatedCount = geocoded.filter((row) => Number.isFinite(row.lat)).length;
  const stageCounts = {};
  for (const row of geocoded) stageCounts[row.stage_text] = (stageCounts[row.stage_text] ?? 0) + 1;
  writeFileSync(metaPath, `${JSON.stringify({
    retrieved_at: artifact.retrieved_at,
    record_count: geocoded.length,
    located_count: locatedCount,
    stage_counts: stageCounts,
    previous_record_count: previous?.record_count ?? null,
  }, null, 1)}\n`, "utf8");
  console.log(`산출물 저장: ${outputPath} (${geocoded.length}건, 좌표 ${locatedCount}건)`);
}

await main();
