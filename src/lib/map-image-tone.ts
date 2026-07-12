/**
 * 보고서 베이스맵 흑백 톤 변환 — 순수 유틸.
 *
 * 원본 보고서(260311 사이트현황, slide 3·5)의 "풀블리드 흑백(탈채도+어둡게) 위성지도" 문법을
 * 재현한다. 컬러 위성지도를 그대로 쓰면 노선·폴리곤·마커 같은 오버레이 색이 지도 색과 경쟁하므로,
 * 지도를 grayscale+어둡게+약한 대비 보정해 오버레이 색이 시각적으로 주인공이 되게 한다.
 *
 * 미리보기(canvas, `ppt-canvas-renderer.ts`)와 내보내기(pptx, `ppt-generator.ts`) 두 렌더러가
 * 같은 변환 결과(dataURL)를 쓰도록 하는 공유 단일 소스 — 동일 입력에 대해서는 변환을 1회만
 * 수행하고 캐시한다 (Promise 캐시 — 동시 호출도 중복 처리하지 않음).
 */

const TONE_FILTER = "grayscale(1) brightness(0.6) contrast(1.1)";

/** 원본 이미지 식별자(dataURL 또는 img.src) → 변환된 dataURL Promise */
const toneCache = new Map<string, Promise<string>>();

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("지도 이미지 로드 실패 (톤 변환)"));
    img.src = src;
  });
}

function renderToned(img: HTMLImageElement): string {
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D 캔버스 컨텍스트를 생성할 수 없습니다 (지도 톤 변환)");
  ctx.filter = TONE_FILTER;
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.92);
}

/**
 * baseMapImage(HTMLImageElement 또는 dataURL)를 offscreen canvas에서
 * grayscale(1) brightness(0.6) contrast(1.1) 적용한 dataURL로 변환.
 *
 * 동일 입력(같은 dataURL 문자열 또는 같은 img.src)에 대해서는 캐시된 결과를 재사용하므로,
 * 같은 베이스맵을 미리보기와 pptx 양쪽에서 변환 요청해도 실제 픽셀 처리는 1회만 일어난다.
 */
export function toReportMapTone(image: HTMLImageElement | string): Promise<string> {
  const key = typeof image === "string" ? image : image.src;

  if (key) {
    const cached = toneCache.get(key);
    if (cached) return cached;
  }

  const promise = (typeof image === "string" ? loadImageElement(image) : Promise.resolve(image)).then(renderToned);

  if (key) {
    toneCache.set(key, promise);
    // 실패한 변환은 캐시에서 제거해 재시도 가능하게 한다.
    promise.catch(() => toneCache.delete(key));
  }

  return promise;
}
