# Implementation Plan - MVP

## Phase Breakdown

### Phase 1: Project Setup (Day 1)
- [ ] Next.js 15 + TypeScript 프로젝트 초기화
- [ ] Tailwind CSS 4 + shadcn/ui 설정
- [ ] Mapbox GL JS 설치 및 기본 지도 렌더링
- [ ] Zustand 스토어 기본 구조
- [ ] 환경변수 설정 (.env.local: MAPBOX_TOKEN)

### Phase 2: Map & Search (Day 2-3)
- [ ] 주소 검색 (Mapbox Geocoding API)
- [ ] 위성 지도 표시 + 줌/이동
- [ ] 분석 반경 원 표시 (1km/2km/3km)
- [ ] 지도 캡처 기능 (preserveDrawingBuffer + html-to-image)

### Phase 3: POI Overlay (Day 4-5)
- [ ] POI 타입 정의 (subway, school, park, mountain)
- [ ] 지하철역 마커 + 노선 색상
- [ ] 학교 마커 + 유형 구분
- [ ] 공원 영역 폴리곤
- [ ] 산 마커/영역
- [ ] POI 카테고리별 토글
- [ ] 마커 클릭 팝업

### Phase 4: Apartment Data (Day 6-7)
- [ ] 아파트 분양 데이터 모델
- [ ] 반경 내 아파트 표시 (마커 + 라벨)
- [ ] 대상지~아파트 거리선
- [ ] 아파트 수동 추가 폼
- [ ] 아파트 정보 테이블

### Phase 5: PPT Generation (Day 8-9)
- [ ] PptxGenJS 연동
- [ ] 슬라이드 템플릿 구현 (6종)
- [ ] 카테고리별 지도 캡처 (각 레이어 on/off)
- [ ] PPT 다운로드 기능
- [ ] 표지 슬라이드 디자인

### Phase 6: Polish & QA (Day 10)
- [ ] UI 다듬기 (간격, 폰트, 색상)
- [ ] PPT 출력 품질 검증
- [ ] 에러 핸들링
- [ ] 기본 로딩 상태 처리

## Acceptance Criteria (MVP)

1. 주소 입력 → 위성지도 표시 (3초 이내)
2. 반경 2km 내 POI 4종 오버레이 표시
3. 아파트 분양 정보 마커 + 거리선 표시
4. 6장 슬라이드 PPT 다운로드 (10초 이내)
5. PPT 이미지 해상도 1920x1080 이상

## MVP Delivery: 10 Working Days

## Dependencies for Development Team

| Item | Owner | Blocker? |
|------|-------|----------|
| Mapbox API Token | 개발팀 | YES - Day 1 필수 |
| 공공데이터 API Key | 개발팀 | NO - 더미 데이터로 시작 가능 |
| 아이콘셋 디자인 | 디자인팀 | NO - Lucide 아이콘 폴백 |
| PPT 템플릿 시안 | 디자인팀 | NO - 기본 템플릿으로 시작 |
| 컬러 팔레트 확정 | 디자인팀 | NO - 제안 팔레트 사용 가능 |
