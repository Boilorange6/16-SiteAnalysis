# Technical Stack Specification

## Architecture

**패턴:** Client-side SPA (서버리스)
**이유:** MVP 단계에서 서버 인프라 부담 최소화. 모든 처리를 브라우저에서 수행.

```
[Browser]
  ├── Next.js (App Router)
  ├── Mapbox GL JS (지도 렌더링)
  ├── html-to-image (지도 캡처)
  └── PptxGenJS (PPT 생성/다운로드)
```

## Stack Decision

| Layer | Technology | Version | Rationale |
|-------|-----------|---------|-----------|
| Framework | Next.js | 15.x | App Router, 빠른 개발, 정적 배포 가능 |
| Language | TypeScript | 5.x | 타입 안전성 |
| Map | Mapbox GL JS | 3.x | 위성 타일, 커스텀 레이어, 고해상도 캡처 |
| PPT | PptxGenJS | 3.x | 브라우저 네이티브 PPTX 생성 |
| Styling | Tailwind CSS | 4.x | 빠른 UI 개발 |
| State | Zustand | 5.x | 경량 전역 상태 (지도 설정, POI 데이터) |
| UI Components | shadcn/ui | latest | 일관된 디자인, 접근성 |
| Map Capture | html-to-image | 1.x | DOM을 고해상도 PNG로 변환 |
| Icons | Lucide React | latest | POI 아이콘 |

## Directory Structure (Proposed)

```
src/
├── app/
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   ├── map/
│   │   ├── map-container.tsx      # Mapbox 지도 래퍼
│   │   ├── poi-layer.tsx          # POI 오버레이 레이어
│   │   ├── apartment-layer.tsx    # 아파트 분양 레이어
│   │   └── map-controls.tsx       # 줌/범위 컨트롤
│   ├── sidebar/
│   │   ├── address-search.tsx     # 주소 검색
│   │   ├── poi-toggle.tsx         # POI 카테고리 토글
│   │   ├── apartment-panel.tsx    # 아파트 정보 패널
│   │   └── export-button.tsx      # PPT 다운로드 버튼
│   └── ppt/
│       ├── slide-builder.ts       # 슬라이드 구성 로직
│       └── slide-templates.ts     # 슬라이드 템플릿
├── lib/
│   ├── mapbox.ts                  # Mapbox 설정/유틸
│   ├── poi-data.ts                # POI 데이터 페칭
│   ├── apartment-data.ts          # 아파트 데이터 페칭
│   └── capture.ts                 # 지도 캡처 유틸
├── store/
│   └── analysis-store.ts          # Zustand 스토어
└── types/
    └── index.ts                   # 공통 타입 정의
```

## API Keys Required

| Service | Key Type | Free Tier |
|---------|----------|-----------|
| Mapbox | Access Token | 50K map loads/month |
| 공공데이터포털 | API Key | 무제한 (일 1,000건) |

## Deployment

- **MVP:** Vercel (Next.js 네이티브 지원, 무료 티어)
- **도메인:** 추후 결정

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Mapbox 위성 타일 캡처 제한 | HIGH | preserveDrawingBuffer 옵션 + html-to-image 폴백 |
| 공공데이터 API 응답 지연 | MEDIUM | 주요 도시 데이터 사전 캐싱 |
| PptxGenJS 이미지 해상도 | MEDIUM | devicePixelRatio 2x 캡처 |
| CORS 이슈 (공공 API) | MEDIUM | Next.js API Route로 프록시 |
