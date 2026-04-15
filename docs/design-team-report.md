# [디자인팀] MVP 보완 항목 결과물 (v0.1)

## 1. 개요
Planned 회의에서 도출된 디자인팀 보완 항목 3건에 대해 실행을 완료하고, 아래와 같이 1차 결과물을 개발팀 및 기획팀에 공유합니다.

## 2. 작업 완료 내역
- **1. 지도 오버레이 아이콘 및 컬러 시스템 정의**
  - 가독성 확보를 위한 Primary Navy (`#1E3A8A`) + Pure White (`#FFFFFF`) 조합의 베이스 컬러 설정
  - 4종 POI 및 아파트 마커에 대한 SVG 애셋 제작 (24px/48px 범용)
    - `public/assets/icons/subway.svg` (지하철: Navy)
    - `public/assets/icons/school.svg` (학교: Navy)
    - `public/assets/icons/park.svg` (공원: Navy)
    - `public/assets/icons/mountain.svg` (산: Navy)
    - `public/assets/icons/apartment.svg` (아파트 마커: Red `#EF4444` 포인트 강조)

- **2. PPT 슬라이드 마스터 레이아웃 템플릿 시안**
  - 16:9 비율 (1920x1080) 기준의 타이포그래피, 마진, 헤더/바디/푸터 컴포넌트 규격 확정
  - `docs/design-spec.md`에 레이아웃 스펙 기재

- **3. 위성지도 위 반투명 배경 처리 가이드라인 수립**
  - 지도 위 텍스트 가독성을 보장하기 위한 오버레이 규칙 정의 (Backdrop Blur + Alpha Opacity + Drop Shadow)
  - `docs/design-spec.md`에 개발 구현을 위한 CSS 속성 스펙 명시 완료

## 3. 넥스트 스텝 (Next Steps)
- **개발팀:**
  - 본 가이드의 컬러, 레이아웃 스펙, 오버레이 CSS 스펙을 바탕으로 Mapbox GL JS 마커 UI 및 PptxGenJS 슬라이드 구현에 적용.
  - 제공된 SVG 아이콘을 `public/assets/icons/` 경로에 배치하여 Mapbox Symbol Layer 또는 HTML Marker로 렌더링 검증 요망.
