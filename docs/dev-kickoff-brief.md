# 개발팀 킥오프 브리프

> 작성: 기획팀 Clio | 2026-04-15
> 대상: 개발팀 | 목적: 즉시 착수 가능한 1장짜리 요약

---

## 한 줄 요약

**주소 입력 → 위성지도 + POI 오버레이 → 7슬라이드 PPT 자동 생성** 웹앱 MVP

## 확정 사항

| 결정 항목 | 확정 내용 |
|----------|----------|
| 지도 엔진 | Mapbox GL JS 3.x (위성타일, Canvas 캡처) |
| 프레임워크 | Next.js 15 + TypeScript + Tailwind + Zustand + shadcn/ui |
| PPT 생성 | PptxGenJS 3.x (브라우저 내 생성) |
| 지도 캡처 | html-to-image (preserveDrawingBuffer: true) |
| 범위 입력 | 주소 검색 + 반경 슬라이더 (1~5km, 기본 2km) |
| 데이터 | 시드 JSON (강남역 2km, 청와대 3km) — API 연동은 Phase 2 |

## 블로킹 1건

Mapbox Access Token 발급 (mapbox.com → 5분 소요)

## 시드 데이터 위치

```
public/data/seed/           → 강남역 (기본)
public/data/seed/cheongwadae/ → 청와대 (프로덕션 테스트)
```

## 수락 기준

1. 주소 → 위성지도 ≤3초
2. POI 4종 마커 표시
3. 아파트 거리선 + 가격 라벨
4. 7슬라이드 PPT 다운로드 ≤10초
5. 이미지 ≥1920x1080px

## 상세 참조

- 전체 선행확정표: [`docs/mvp-prerequisite-confirmation.md`](./mvp-prerequisite-confirmation.md)
- 기존 스펙 문서: 각 팀 워크트리의 docs/ 디렉토리 참조
