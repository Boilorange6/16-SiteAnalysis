/**
 * 주거 단지 식별과 법정동 탐색 지점 계산.
 *
 * 이름만으로 단지를 식별하면 같은 반경 안의 서로 다른 "현대아파트"·"주공아파트"가
 * 하나로 합쳐진다(개포동 653/654가 실제 사례). 지번 코드를 1순위 키로 쓴다.
 */

export interface BuildingIdentity {
  readonly bldNm: string;
  readonly sigunguCd: string;
  readonly bjdongCd: string;
  readonly bun: string;
  readonly ji: string;
  readonly lat?: number;
  readonly lng?: number;
}

/** "0653" / "653" → "653", 빈 값이나 0은 "" */
function normalizeLotNumber(value: string): string {
  const digits = value.trim().replace(/^0+/, "");
  return digits === "" || digits === "0" ? "" : digits;
}

/** 단지명에서 동 표기와 공백을 제거 — "개포현대아파트 101동" → "개포현대아파트" */
function normalizeComplexName(name: string): string {
  return name.replace(/\s+[\dA-Za-z]+동$/u, "").normalize("NFKC").replaceAll(/\s+/gu, "").trim();
}

/** 지번 없는 건물의 폴백 격자 — 약 100m 해상도 */
const FALLBACK_GRID = 1_000;

/**
 * 같은 단지의 동별 건물만 병합되는 중복 제거 키.
 * 지번 코드(시군구+법정동+본번+부번)가 1순위, 없으면 이름 + 좌표 격자로 폴백한다.
 */
export function buildingDedupeKey(building: BuildingIdentity): string {
  const bun = normalizeLotNumber(building.bun);
  if (bun) {
    const ji = normalizeLotNumber(building.ji);
    return `lot:${building.sigunguCd}-${building.bjdongCd}-${bun}-${ji || "0"}`;
  }
  const name = normalizeComplexName(building.bldNm);
  if (typeof building.lat === "number" && typeof building.lng === "number") {
    const latCell = Math.round(building.lat * FALLBACK_GRID);
    const lngCell = Math.round(building.lng * FALLBACK_GRID);
    return `name:${building.sigunguCd}-${building.bjdongCd}-${name}-${latCell}-${lngCell}`;
  }
  return `name:${building.sigunguCd}-${building.bjdongCd}-${name}`;
}

export interface SamplePoint {
  readonly lat: number;
  readonly lng: number;
}

const METERS_PER_DEGREE_LAT = 111_320;

/** 반경이 커질수록 링을 늘려 좁은 법정동 누락을 줄인다 */
function ringCount(radiusM: number): number {
  if (radiusM <= 1_500) return 1;
  if (radiusM <= 5_000) return 2;
  return 3;
}

/**
 * 반경 내 법정동을 찾기 위한 역지오코딩 샘플 지점.
 * 경도 오프셋에 cos(위도) 보정을 적용한다 — 보정 전에는 서울 위도에서
 * 동서 방향 실거리가 의도한 반경보다 약 21% 짧아 좁은 법정동을 놓쳤다.
 * 모든 지점은 반경 안에 위치한다(반경 밖 법정동을 수집하지 않기 위해).
 */
export function sampleDongPoints(
  centerLat: number,
  centerLng: number,
  radiusM: number,
): readonly SamplePoint[] {
  const points: SamplePoint[] = [{ lat: centerLat, lng: centerLng }];
  const latRadians = (centerLat * Math.PI) / 180;
  const cosLat = Math.max(Math.cos(latRadians), 0.01);
  const rings = ringCount(radiusM);

  for (let ring = 1; ring <= rings; ring += 1) {
    const ringRadius = (radiusM * ring) / rings;
    const latOffset = ringRadius / METERS_PER_DEGREE_LAT;
    const lngOffset = ringRadius / (METERS_PER_DEGREE_LAT * cosLat);
    // 바깥 링일수록 둘레가 기니 더 촘촘히 샘플링한다
    const spokes = 4 * (ring + 1);
    for (let index = 0; index < spokes; index += 1) {
      const angle = (2 * Math.PI * index) / spokes;
      points.push({
        lat: centerLat + latOffset * Math.cos(angle),
        lng: centerLng + lngOffset * Math.sin(angle),
      });
    }
  }
  return points;
}
