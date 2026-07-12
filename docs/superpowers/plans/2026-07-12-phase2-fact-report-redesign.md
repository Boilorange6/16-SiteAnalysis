# 2단계: 팩트 중심 보고서 + 회사 템플릿 전면 적용 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PPT 산출물(미리보기+내보내기)을 회사 기존 보고서(260311 사이트현황)의 디자인 문법으로 전면 교체하고, 종합점수를 보조로 내리고 팩트(거리·개수·시간·출처)를 주인공으로 재편한다.

**Architecture:** 디자인 토큰의 단일 소스는 `docs/superpowers/specs/2026-07-12-phase2-design-language.md`. 모든 시각 변경은 두 렌더러(ppt-canvas-renderer=미리보기, ppt-generator=pptx)에 **동일 수치로 쌍 적용**하며, 각 태스크는 `node qa/validate-preview-parity.mjs` 통과를 게이트로 갖는다. 웹 지도 화면은 건드리지 않는다.

**Tech Stack:** 기존 canvas/pptxgenjs 이중 렌더러, next/font(Noto Sans KR)+로컬 Pretendard, 기존 qa 스크립트 관례.

## Global Constraints

- 디자인 토큰·수치·문법: `docs/superpowers/specs/2026-07-12-phase2-design-language.md`가 소스 (요약: 강조 빨강, 대상지 빨강 폴리곤, 비교 베이지, 흑백 탈채도 지도, 점선 노선+역 도트, 라운드 검정 인사이트 카드, 백색 팩트 시트+검정 헤더 표, 표지 흑배경 초대형 타이틀)
- **미리보기=내보내기 시각 동등**: 신규·변경 요소의 좌표/크기/색/폰트를 두 렌더러에 동일 수치로 — 태스크마다 `node qa/validate-preview-parity.mjs` + `npm run lint` exit 0
- **개별 요소 편집성 유지**: pptx는 이미지 캡처가 아니라 도형·텍스트 요소로 (기존 원칙)
- 모든 수치 팩트에 출처·수집일 연결 (1단계 sourceStatuses·sourceStatusLines 재사용)
- 점수 대시보드: 기본 제외, 내보내기 옵션으로만 포함 가능 (로드맵 2-2)
- PPT 지도에 집GPT식 **역사도식선·역명/노선 배지** 반영 (출입구 제외 — 로드맵 2-4 확정)
- 웹 지도(map-view.tsx) 및 서버 데이터 파이프라인 수정 금지
- 원본 pptx(docs/*.pptx)는 커밋 금지 (gitignore 됨)
- 커밋 한국어 + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: 폰트 도입 (웹 미리보기 + PPT fontFace)

**Files:**
- Modify: `src/app/layout.tsx` (next/font), `src/app/globals.css`
- Create: `public/fonts/` (Pretendard woff2 서브셋 — pretendard 공식 GitHub 릴리스에서 다운로드)
- Modify: `src/lib/ppt-design-config.ts` (FONT 상수), `src/lib/ppt-canvas-renderer.ts`·`src/lib/ppt-generator.ts`의 fontFace 참조부

**Interfaces:**
- Produces: `PPT_FONT_MAIN = "Noto Sans KR"`, `PPT_FONT_NUM = "Pretendard"` (design-config export) — 이후 태스크 전부 이 상수만 사용

**Steps:**
- [ ] next/font/google로 Noto Sans KR(400/500/700/900) 로드, CSS 변수 `--font-noto-kr` 등록 (기존 폰트 변수 패턴 따름 — layout.tsx에 이미 CSS 변수 방식 존재)
- [ ] Pretendard: 공식 woff2(Medium/SemiBold/ExtraLight)를 public/fonts에 추가, @font-face 선언 (next/font/local도 가능 — 기존 코드 관례 따름)
- [ ] canvas 렌더러가 폰트 로드 완료 후 그리도록 `document.fonts.load()` 대기 확인 (기존 preloadBaseImage 패턴 옆에)
- [ ] pptx fontFace 문자열을 상수로 교체. **주의**: pptx는 폰트 임베드가 안 되므로 열람 PC에 폰트 필요 — README 또는 docs에 팀 설치 안내 1줄 추가
- [ ] `npm run lint` + parity + 커밋 "feat: 보고서 서체 Noto Sans KR/Pretendard 도입"

### Task 2: 디자인 토큰 전면 개편 + 지도 흑백화

**Files:**
- Modify: `src/lib/ppt-design-config.ts` (DEFAULT_PPT_DESIGN)
- Modify: `src/lib/ppt-canvas-renderer.ts`·`src/lib/ppt-generator.ts` (베이스맵 전처리)

**Interfaces:**
- Produces: 새 토큰 — `accentRed`(수치·대상지 강조), `insightCardBg/insightCardText`, `polygonComparison`(베이지), `mapGrayscale: true` 등. 기존 토큰 이름은 유지하고 값 교체+추가(하위호환)

**Steps:**
- [ ] design-language 문서의 톤에 맞춰 DEFAULT_PPT_DESIGN 값 교체 (지도 억제 오버레이는 흑백화와 중복되지 않게 재조정)
- [ ] 베이스맵 흑백화: 공유 지점 한 곳에서 처리 — baseMapImage를 offscreen canvas에서 `grayscale(1) brightness(0.6) contrast(1.1)` 적용한 dataURL로 변환하는 유틸 `src/lib/map-image-tone.ts` 신규, 두 렌더러가 같은 변환본을 사용 (pptx도 변환된 이미지 삽입 — parity 보장)
- [ ] 미리보기 열어 지도 톤이 원본 보고서 slide 3·5와 유사한지 스크린샷 비교 (리뷰어 확인용으로 스크린샷 저장)
- [ ] lint + parity + 커밋 "design: 보고서 토큰 개편 — 흑백 지도·빨강 강조·검정 인사이트 카드 팔레트"

### Task 3: 표지 슬라이드 재설계

**Files:** Modify: 두 렌더러의 cover 함수 (`renderCoverSlide`/`addCoverSlide`)

**Steps:**
- [ ] 흑색(#1A1A1A) 배경(지도 이미지 제거 또는 5% 미만 톤로 은은하게 — design 문서 기준은 순수 흑배경+테두리 장식), 우측 얇은 흰 테두리 사각 2개 오프셋 배치
- [ ] 좌상단 아이브로우 2줄(주소 요약 / "사이트 입지 분석"), 자간 넓게
- [ ] 좌하단 초대형 타이틀(centerName) + 메타 행 `반경 {r}km / {날짜} / Site Analysis` 슬래시 구분
- [ ] 1단계 누락 경고(hasFailedSource) footer 위치 보존
- [ ] lint + parity + 커밋 "design: 표지 재설계 — 흑배경·초대형 타이틀·메타 행"

### Task 4: 백색 팩트 시트 슬라이드 (신규) + 출처 슬라이드 백색 전환

**Files:**
- Create: 두 렌더러에 `renderFactSheetSlide`/`addFactSheetSlide` (표지 다음, 2번 위치)
- Modify: 출처 슬라이드(renderDataSourceSlide/addDataSourceSlide) 백색 전환
- Create: `src/lib/fact-summary.ts` — 팩트 계산 순수 모듈

**Interfaces:**
- Produces: `buildFactSummary(input): FactSummary` — `{ transit: { nearestStation, distanceM, walkMin, lineCount }, education: { schoolCount, nearestSchool, distanceM }, nature: {...}, housing: { complexCount, totalHouseholds } }` — 도보시간 = 직선거리 80m/분 환산 명시. Task 5의 인사이트 카드도 이 모듈 사용

**Steps:**
- [ ] fact-summary.ts: SlideRenderInput의 pois/config에서 카테고리별 팩트 계산 (haversine은 geo.ts 재사용). 테스트 `src/scripts/test-fact-summary.mjs` (고정 입력→기대 팩트, npx tsx)
- [ ] 팩트 시트: 흰 배경, 중앙 제목(수평선 플랭크), 검정 헤더 표 — 행: 분석 대상/반경/분석일/최근접 역(거리·도보시간)/학교 수/공원·산/주거 단지·세대수 — **수치 빨강 강조**, 각 행 끝에 출처 약칭
- [ ] 출처 슬라이드 백색 전환(기존 내용 유지, 배색만 — 1단계 수집일·누락 표기 보존)
- [ ] lint + parity + 커밋 "feat: 백색 팩트 시트 슬라이드 + 출처 슬라이드 백색 전환"

### Task 5: 지도 분석 슬라이드 문법 적용 (본론 5종)

**Files:** Modify: 두 렌더러의 overview/category 슬라이드 함수군

**Steps:**
- [ ] 좌상단 볼드 화이트 섹션 타이틀(기존 타이틀 칩 대체) + 서브라벨
- [ ] 노선 폴리라인 점선화 + 역 위치 도트, **역사도식선(흰 캐싱+노선색)·역명/노선 배지** 추가 — 웹 이식분(osm-subway-overlay.ts)의 시각 문법을 PPT 좌표계로 번역(출입구 제외). 데이터는 기존 routePositions/poiPositions 사용
- [ ] 대상지: 반경 링 유지 + 중심 빨강 강조 (폴리곤 데이터 없으므로 마커+링의 빨강화)
- [ ] **인사이트 카드**: 각 카테고리 슬라이드 우측에 라운드 검정 카드 — fact-summary 기반 문장 2-4줄 (예: "최근접 시청역 도보 4분(320m) / 반경 내 지하철역 12개·6개 노선"). 데이터 0건이면 기존 EMPTY_PANEL_TEXT 문법 유지
- [ ] 범례 좌하단 통일, 지명 색 문법(도로 흰/산 초록/수계 하늘) 적용 가능한 범위 내 적용
- [ ] lint + parity + 커밋 "design: 지도 분석 슬라이드 — 점선 노선·도식선·인사이트 카드 문법"

### Task 6: 아파트 콜아웃 → 리더라인+미니 데이터표

**Files:** Modify: 두 렌더러의 apartment callout 함수 (renderApartmentCalloutSlide/addApartmentCalloutSlide)

**Steps:**
- [ ] 기존 콜아웃 카드를 미니 데이터표로 교체: 헤더(단지명) + 행(세대수/입주/전용면적대 — 가용 필드만), 대상지 인접 최상위 1개는 빨강 헤더, 나머지 검정
- [ ] 리더라인(흰 1px) 유지, 표 겹침 방지 로직(기존 callout-layout) 재사용
- [ ] empty-state 배지 문법 유지
- [ ] lint + parity + 커밋 "design: 아파트 콜아웃 미니 데이터표 전환"

### Task 7: 점수 대시보드 강등 + 슬라이드 구성 재편

**Files:** Modify: `buildSlideDefs`(canvas)·generateSiteAnalysisPpt 슬라이드 순서, ppt-preview-modal(옵션 UI), 두 렌더러 종합의견 슬라이드

**Steps:**
- [ ] 기본 구성: 표지 → 팩트 시트 → 입지 종합 → 교통 → 교육 → 자연 → 주거/분양 → 아파트 콜아웃 → 종합 의견 → 출처 (점수 대시보드 제외)
- [ ] 내보내기 옵션에 "점수 대시보드 포함" 토글 (미리보기 모달 — 기존 슬라이드 선택 UI에 결합)
- [ ] 종합 의견 슬라이드에 보조 지표로 점수 1줄 (강조 없이 muted)
- [ ] lint + parity + 커밋 "feat: 팩트 중심 슬라이드 재편 — 점수 대시보드 옵션화"

### Task 8: 수용 테스트 (Fable 런타임 검증)

- [ ] 미리보기 전 슬라이드 스크린샷 ↔ 원본 보고서 슬라이드 나란히 비교 (표지/팩트시트/지도/콜아웃/출처 5장면)
- [ ] PPT 다운로드 → PowerPoint COM으로 PNG 내보내 미리보기와 대조 (시각 parity 실물 확인)
- [ ] 팩트 시트 수치 = 지도 데이터 일치 (예: 역 개수·최근접 거리 수동 대조)
- [ ] 다운로드한 pptx에서 텍스트·도형이 개별 선택·편집 가능한지 확인
- [ ] 점수 토글 on/off 동작, 데이터 누락 상태에서 누락 표기 유지
- [ ] 회귀: 기존 테스트 체인 + 1단계 수용 항목 재확인(수집 상태 카드)
- [ ] 최종 관문: **사용자 육안 승인** — 원본 보고서와 나란히 보고 "다듬으면 제출 가능" 판정 (스펙 완료 기준)
