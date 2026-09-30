/**
 * 태양 위치 (NOAA 태양 계산식). 방위각은 북쪽 기준 시계방향(°), 고도는 수평선 위(°).
 * 대기굴절은 넣지 않는다(기하학적 고도). 일출·일몰만 표준 보정 -0.833°를 쓴다.
 * 시각은 절대 시각(Date)이고, KST(UTC+9) 벽시계 시각은 kst()로 만든다.
 */
const RAD = Math.PI / 180;
const KST_OFFSET_MS = 9 * 3600_000;

/** KST 벽시계 시각 → 절대 시각. month는 1~12. */
export function kst(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - KST_OFFSET_MS);
}

export interface SunPosition {
  azimuthDeg: number;
  altitudeDeg: number;
}

export function sunPosition(latDeg: number, lonDeg: number, at: Date): SunPosition {
  const jd = at.getTime() / 86400000 + 2440587.5;
  const T = (jd - 2451545.0) / 36525;
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const Mr = M * RAD;
  const C = Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * Mr) * (0.019993 - 0.000101 * T) + Math.sin(3 * Mr) * 0.000289;
  const omega = 125.04 - 1934.136 * T;
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD));
  const y = Math.tan((eps * RAD) / 2) ** 2;
  const L0r = L0 * RAD;
  const eqTimeMin =
    4 / RAD * (y * Math.sin(2 * L0r) - 2 * e * Math.sin(Mr) + 4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r) - 0.5 * y * y * Math.sin(4 * L0r) - 1.25 * e * e * Math.sin(2 * Mr));

  const utcMin = (at.getUTCHours() * 60 + at.getUTCMinutes()) + at.getUTCSeconds() / 60 + at.getUTCMilliseconds() / 60000;
  const trueSolarMin = (((utcMin + eqTimeMin + 4 * lonDeg) % 1440) + 1440) % 1440;
  const ha = (trueSolarMin / 4 < 0 ? trueSolarMin / 4 + 180 : trueSolarMin / 4 - 180) * RAD;

  const lat = latDeg * RAD;
  const cosZ = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  const zenith = Math.acos(Math.min(1, Math.max(-1, cosZ)));
  const altitudeDeg = 90 - zenith / RAD;
  // 방위각: 남쪽 기준 계산 후 북쪽 기준 시계방향으로 변환
  const az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat));
  const azimuthDeg = (((az / RAD + 180) % 360) + 360) % 360;
  return { azimuthDeg, altitudeDeg };
}

/** KST 하루의 일출·일몰(KST 분, 0~1440). 극지 예외는 다루지 않는다(한국 위도 전용). 표준 보정 -0.833°. */
export function sunriseSunsetKstMin(latDeg: number, lonDeg: number, year: number, month: number, day: number): { sunrise: number; sunset: number } {
  const alt = (min: number) => sunPosition(latDeg, lonDeg, kst(year, month, day, 0, 0 + min)).altitudeDeg + 0.833;
  const bisect = (lo: number, hi: number) => {
    const rising = alt(lo) < alt(hi);
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (alt(mid) < 0 === rising) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  return { sunrise: bisect(180, 720), sunset: bisect(720, 1260) };
}
