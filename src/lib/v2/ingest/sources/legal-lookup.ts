/**
 * core legal_sigungu 경계로 좌표의 법정코드를 찾는 빠른 조회.
 * queryFeaturesInRadius(core, p, r, ["legal_sigungu"])[0]?.legalCode 와 결과가 같다 — 그쪽은 질의마다
 * 수 MB 경계 JSON을 다시 파싱하고 turf로 전 정점을 훑어 초당 수백 건에 그친다(OSM 도로 ~380만 건에 4시간+).
 *
 * 같은 후보 선정(R*Tree bbox → 외접 64각형 거리 → feature_id 순)을 하되, 교차 판정만 가속한다:
 *  - 경계 선분이 원의 bbox와 겹치지 않으면 원은 경계를 건드리지 않으므로 통째로 안 아니면 밖이다 → 중심점의 안팎만 보면 된다.
 *  - 안팎은 1 km 칸의 기준점(칸마다 한 번 O(정점))에서 중심점까지 선분이 경계를 가르는 횟수의 홀짝으로 바꾼다.
 *  - 경계가 원 근처에 있으면 기존 turf 판정으로 되돌아간다(전체 질의의 1% 미만).
 */
import type BetterSqlite3 from "better-sqlite3";
import type { Geometry, Position } from "geojson";
import { booleanIntersects } from "@turf/turf";
import { toUtmk } from "../../crs";
import { circlePolygon } from "../../data/features";

type Db = BetterSqlite3.Database;
const CELL_M = 1000;
const CIRCLE_SEGMENTS = 64;
const CELL_KEY = (ix: number, iy: number) => ix * 8192 + iy;

class Boundary {
  /** 선분 i = (xs[2i],ys[2i]) → (xs[2i+1],ys[2i+1]), poly[i]는 그 선분이 속한 폴리곤 번호 */
  private readonly ax: Float64Array;
  private readonly ay: Float64Array;
  private readonly bx: Float64Array;
  private readonly by: Float64Array;
  private readonly poly: Int32Array;
  private readonly polys: number;
  readonly bbox: [number, number, number, number];
  private readonly cells = new Map<number, Int32Array>();
  private readonly refInside = new Map<number, Uint8Array>();

  constructor(readonly geometry: Geometry, pad: number) {
    const parts: Position[][][] = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
    this.polys = parts.length;
    const ax: number[] = [], ay: number[] = [], bx: number[] = [], by: number[] = [], poly: number[] = [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    parts.forEach((rings, p) => {
      for (const ring of rings) {
        for (let i = 0; i + 1 < ring.length; i++) {
          ax.push(ring[i][0]); ay.push(ring[i][1]); bx.push(ring[i + 1][0]); by.push(ring[i + 1][1]); poly.push(p);
        }
        for (const [x, y] of ring) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
    });
    this.ax = Float64Array.from(ax); this.ay = Float64Array.from(ay); this.bx = Float64Array.from(bx); this.by = Float64Array.from(by);
    this.poly = Int32Array.from(poly);
    this.bbox = [x0, y0, x1, y1];
    const lists = new Map<number, number[]>();
    for (let i = 0; i < ax.length; i++) {
      const lox = Math.min(ax[i], bx[i]) - pad, hix = Math.max(ax[i], bx[i]) + pad;
      const loy = Math.min(ay[i], by[i]) - pad, hiy = Math.max(ay[i], by[i]) + pad;
      for (let cx = Math.floor(lox / CELL_M); cx <= Math.floor(hix / CELL_M); cx++) {
        for (let cy = Math.floor(loy / CELL_M); cy <= Math.floor(hiy / CELL_M); cy++) {
          const k = CELL_KEY(cx, cy);
          const l = lists.get(k);
          if (l) l.push(i); else lists.set(k, [i]);
        }
      }
    }
    for (const [k, l] of lists) this.cells.set(k, Int32Array.from(l));
  }

  /** 폴리곤마다, 점이 (짝홀 규칙으로) 안인지. 점 p에서 q까지 선분이 경계를 가르는 횟수의 홀짝을 더한다. */
  private insideAll(px: number, py: number, only: Int32Array | null): Uint8Array {
    const out = new Uint8Array(this.polys);
    const n = only ? only.length : this.ax.length;
    for (let j = 0; j < n; j++) {
      const i = only ? only[j] : j;
      const y1 = this.ay[i], y2 = this.by[i];
      if ((y1 > py) === (y2 > py)) continue;
      const x = this.ax[i] + ((py - y1) * (this.bx[i] - this.ax[i])) / (y2 - y1);
      if (x > px) out[this.poly[i]] ^= 1;
    }
    return out;
  }

  /**
   * 원(내접 반지름 inner, 외접 outer)이 경계와 닿는가. true=닿음/안, false=밖, null=turf로 가려야 하는 접선 근처(inner~outer 띠).
   * 64각형은 반지름 inner 원판을 품고 outer 원판 안에 든다: 선분이 중심에서 inner 이내면 교차, outer 밖이면 불교차가 확실하다.
   */
  touches(cx: number, cy: number, inner: number, outer: number): boolean | null {
    const key = CELL_KEY(Math.floor(cx / CELL_M), Math.floor(cy / CELL_M));
    const list = this.cells.get(key);
    const ix = Math.floor(cx / CELL_M) * CELL_M + CELL_M / 2;
    const iy = Math.floor(cy / CELL_M) * CELL_M + CELL_M / 2;
    let ref = this.refInside.get(key);
    if (!ref) {
      ref = this.insideAll(ix, iy, null);
      this.refInside.set(key, ref);
    }
    if (!list) return ref.some((v) => v === 1);
    const loX = cx - outer - EPS, hiX = cx + outer + EPS, loY = cy - outer - EPS, hiY = cy + outer + EPS;
    let unsure = false;
    for (let j = 0; j < list.length; j++) {
      const i = list[j];
      const ax = this.ax[i], ay = this.ay[i], bx = this.bx[i], by = this.by[i];
      if (!(Math.max(ax, bx) >= loX && Math.min(ax, bx) <= hiX && Math.max(ay, by) >= loY && Math.min(ay, by) <= hiY)) continue;
      const d = distToSegment(cx, cy, ax, ay, bx, by);
      if (d <= inner - EPS) return true;
      if (d <= outer + EPS) unsure = true;
    }
    if (unsure) return null;
    const flips = new Uint8Array(this.polys);
    // 중심점 안팎 = 기준점 안팎 ^ (기준점→중심 선분이 경계를 가른 횟수의 홀짝). 그 선분은 칸 안에 있어 칸 목록만 보면 된다.
    for (let j = 0; j < list.length; j++) {
      const i = list[j];
      if (segCross(ix, iy, cx, cy, this.ax[i], this.ay[i], this.bx[i], this.by[i])) flips[this.poly[i]] ^= 1;
    }
    for (let p = 0; p < this.polys; p++) if ((ref[p] ^ flips[p]) === 1) return true;
    return false;
  }
}

const EPS = 1e-6;
function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** 선분 pq 와 ab 가 (반열림 규칙으로) 교차하는가 */
function segCross(px: number, py: number, qx: number, qy: number, ax: number, ay: number, bx: number, by: number): boolean {
  const sa = (qx - px) * (ay - py) - (qy - py) * (ax - px) > 0;
  const sb = (qx - px) * (by - py) - (qy - py) * (bx - px) > 0;
  if (sa === sb) return false;
  const sp = (bx - ax) * (py - ay) - (by - ay) * (px - ax) > 0;
  const sq = (bx - ax) * (qy - ay) - (by - ay) * (qx - ax) > 0;
  return sp !== sq;
}

interface Area {
  featureId: number;
  legalCode: string | null;
  minX: number; maxX: number; minY: number; maxY: number;
  geometry: Geometry;
  boundary?: Boundary;
}

export type LegalCodeOf = (lng: number, lat: number) => string | null;

export function fastLegalCodeFromCore(core: Db | null, radiusM = 50): LegalCodeOf {
  if (!core) return () => null;
  let areas: Area[] | null = null;
  const load = (): Area[] => {
    const rows = core.prepare(`SELECT f.feature_id AS featureId, f.legal_code AS legalCode, f.geom_json AS geom,
        r.min_x AS minX, r.max_x AS maxX, r.min_y AS minY, r.max_y AS maxY
      FROM feature f JOIN feature_rtree r ON r.feature_id = f.feature_id
      WHERE f.kind = 'legal_sigungu' ORDER BY f.feature_id`).all() as (Omit<Area, "geometry"> & { geom: string })[];
    return rows.map(({ geom, ...a }) => ({ ...a, geometry: JSON.parse(geom) as Geometry }));
  };
  const outer = radiusM / Math.cos(Math.PI / CIRCLE_SEGMENTS);
  const outerSq = outer * outer;
  return (lng, lat) => {
    if (!(Number.isFinite(lng) && Number.isFinite(lat))) throw new RangeError(`center must be finite, got ${[lng, lat]}`);
    areas ??= load();
    const [cx, cy] = toUtmk([lng, lat]);
    for (const a of areas) {
      if (!(a.maxX >= cx - radiusM && a.minX <= cx + radiusM && a.maxY >= cy - radiusM && a.minY <= cy + radiusM)) continue;
      const dx = cx < a.minX ? a.minX - cx : cx > a.maxX ? cx - a.maxX : 0;
      const dy = cy < a.minY ? a.minY - cy : cy > a.maxY ? cy - a.maxY : 0;
      if (dx * dx + dy * dy > outerSq) continue;
      const g = a.geometry;
      let hit: boolean;
      if (g.type === "Polygon" || g.type === "MultiPolygon") {
        const b = (a.boundary ??= new Boundary(g, outer + 10));
        if (cx + outer < b.bbox[0] || cx - outer > b.bbox[2] || cy + outer < b.bbox[1] || cy - outer > b.bbox[3]) hit = false;
        else {
          const t = b.touches(cx, cy, radiusM, outer);
          hit = t === null ? booleanIntersects(circlePolygon(cx, cy, radiusM), g) : t;
        }
      } else hit = booleanIntersects(circlePolygon(cx, cy, radiusM), g);
      if (hit) return a.legalCode;
    }
    return null;
  };
}
