# SiteAnalysis Design System

## 1. Atmosphere & Identity

정확한 출처와 공간적 맥락을 한 화면에서 판단하는 조용한 분석 관제실이다. 기존 제품의 시그니처는 짙은 네이비 셸 위에 데이터 종류별 색을 제한적으로 사용하고, 지도와 밀도 높은 패널을 얇은 경계와 톤 차이로 분리하는 방식이다. 이번 정비사업 화면은 이 언어를 보존하며 경계 신뢰도와 데이터 출처를 장식이 아닌 판단 정보로 보여준다.

## 2. Color

| Role | Token / existing utility | Value | Usage |
|---|---|---:|---|
| Shell | `--surface-shell` / `bg-[#0F172A]` | `#0F172A` | 앱·지도 배경 |
| Panel | `--surface-panel` / `bg-[#1E3A8A]` | `#1E3A8A` | 사이드바·대화상자 |
| Recessed | `--surface-recessed` / `bg-[#111827]` | `#111827` | 입력·오류 패널 |
| Text primary | `--text-primary` / `text-white` | `#F8FAFC` | 제목·핵심 수치 |
| Text secondary | `text-white/60` | white 60% | 설명·메타데이터 |
| Border | `border-white/10` | white 10% | 카드·분리선 |
| Action | `--accent-action` / `bg-[#3B82F6]` | `#3B82F6` | 실행·선택·포커스 |
| Maintenance | `--accent-maintenance` / `text-[#EC4899]` | `#EC4899` | 정비사업 경계·수치 |
| Success | `text-emerald-300` | emerald ramp | 수집 성공·공식 확인 |
| Warning | `text-amber-200` | amber ramp | 수집 실패·미결합 |
| Error | `text-red-100` | red ramp | 요청 실패 |

색은 의미를 전달할 때만 쓴다. 정비사업 폴리곤은 동일한 핑크 계열을 사용하고, 실선/점선과 레이블로 상태를 중복 부호화한다. 새 색이 필요하면 이 표를 먼저 갱신한다.

## 3. Typography

- Primary: `Noto Sans KR`, `Pretendard`, system sans-serif.
- Metadata/PPT number fallback: `Pretendard`.
- Page chrome: 10–12px, 700–900 weight, generous tracking only for 짧은 영문 eyebrow.
- Body and project detail: 12–14px, line-height 1.5–1.7; 읽기 본문은 12px 미만으로 내리지 않는다.
- Section title: 14px/700. Primary prompt: 18–20px/700–900.
- CJK 문구는 의미 단위가 짧게 유지되도록 간결한 라벨을 쓰고, 이름·주소는 `overflow-wrap:anywhere`와 충분한 줄높이를 허용한다.

## 4. Spacing & Layout

- Base unit: 4px. 기존 Tailwind steps `1, 2, 3, 4, 5, 6, 8, 10`을 사용한다.
- App shell: `100dvh`, 데스크톱은 고정 폭 사이드바 + 유동 지도, 모바일은 지도 위에 여닫는 시트.
- Scroll ownership: `body`는 스크롤하지 않는다. 데스크톱/모바일 모두 패널 본문 한 곳만 `overflow-y-auto`; 지도와 헤더는 고정한다. 모든 flex 스크롤 조상은 `min-height:0`을 가진다.
- Breakpoints: mobile `<640`, tablet `768`, desktop `1024`, wide `1280`.
- Metric grid: 최소 2열, 여유 폭에서 4열. 상세 행은 좁은 폭에서 한 열로 자연스럽게 흐른다.
- 200% zoom과 390px 폭에서 주요 콘텐츠의 수평 스크롤을 만들지 않는다.

## 5. Components

### PanelCard
- **Structure**: semantic `section`, optional header, body.
- **Variants**: default, warning, error.
- **Spacing**: 16px inner, 12–20px between groups.
- **States**: content, empty, loading, error.
- **Accessibility**: heading order를 유지하고 상태 메시지는 적절한 live region을 사용한다.
- **Motion**: 없음.
- **Layout**: stack; 상위 패널 본문이 scroll owner다.

### MetricTile
- **Structure**: 핵심 값 + 짧은 라벨.
- **Variants**: neutral, category tone.
- **Spacing**: 12px inner, 4px value-to-label.
- **States**: value, unknown (`-`/`미확인`).
- **Accessibility**: 색만으로 의미를 구분하지 않고 라벨을 항상 노출한다.
- **Motion**: 없음.
- **Layout**: compact grid item.

### SourceStatusRow
- **Structure**: 전체 소스명, 상태/기준일, 조건부 retry button.
- **Variants**: fresh, cached, failed, retrying.
- **Spacing**: 6–8px row gap.
- **States**: hover, focus-visible, disabled, loading.
- **Accessibility**: 버튼은 최소 44×44px 터치 영역과 명시적 라벨을 가지며 진행 상태를 텍스트로 알린다.
- **Motion**: 150ms opacity/color only; reduced motion에서 즉시 전환.
- **Layout**: wrapping cluster.

### MaintenanceBoundaryLayer
- **Structure**: 하나의 Polygon/MultiPolygon Leaflet layer와 하나의 popup.
- **Variants**: confirmed solid, unmatched dashed; unavailable은 기존 point marker만 사용한다.
- **Spacing**: N/A.
- **States**: rest, hover, keyboard focus through the associated marker/popup.
- **Accessibility**: popup은 이름·유형·단계·출처·법적 고지를 텍스트로 제공한다.
- **Motion**: 지도 기본 상호작용 외 장식 모션 없음.
- **Layout**: map overlay; holes와 MultiPolygon parts를 하나의 geometry로 보존한다.

### MaintenanceProjectCard
- **Structure**: name, type/stage, implementer, households/area/distance, boundary status.
- **Variants**: confirmed, unmatched, unavailable.
- **Spacing**: 12px inner, 4–8px metadata rhythm.
- **States**: default only unless a real focus action is wired; 행정구역 catalog row는 절대 버튼처럼 보이지 않는다.
- **Accessibility**: 긴 CJK 이름·주소를 자르지 않으며 상태를 글자로 표시한다.
- **Motion**: 없음.
- **Layout**: stack.

### MaintenanceCatalog
- **Structure**: heading, radius-exclusion explanation, coordinate-free rows.
- **Variants**: rows, empty.
- **Spacing**: 12px row padding.
- **States**: content, empty; map-focus state 없음.
- **Accessibility**: 정적 목록 semantics, fake marker/focus action 금지.
- **Motion**: 없음.
- **Layout**: independent stack inside analysis scroll owner.

## 6. Motion & Interaction

- Micro transition: 150ms ease-out for hover/focus color and opacity.
- Standard panel transition: 200–300ms ease-in-out only when state continuity benefits.
- `prefers-reduced-motion: reduce`에서는 spinner를 제외한 비필수 transition/animation을 제거한다.
- 모든 실제 interactive control은 hover, active, focus-visible, disabled/loading 상태를 갖는다. 장식 요소에는 hover를 주지 않는다.
- 지도 popup과 retry는 클릭뿐 아니라 키보드로 도달·실행 가능해야 한다.

## 7. Depth & Surface

혼합 전략이되 기존 제품에 한정한다: 패널 간 깊이는 네이비 톤 변화 + 흰색 8–15% 경계, 지도 옵션·모달처럼 실제로 떠 있는 요소만 기존의 큰 그림자와 blur를 사용한다. 정비사업 상세 카드에는 새 유리 효과나 과도한 radius를 추가하지 않는다.

## 8. Accessibility Constraints & Accepted Debt

### Personas and constraints

- **입지 분석가**: 수십 개 사업에서 세대수·면적·단계·경계 신뢰도를 빠르게 비교하고 출처 기준일을 확인한다.
- **키보드/200% 확대/동작 축소 사용자**: 탭 순서만으로 패널, retry, 지도 marker/popup을 사용할 수 있고 390px 또는 200% zoom에서 핵심 정보가 잘리지 않아야 한다.
- WCAG 2.2 AA: body contrast 4.5:1, large text/UI 3:1, visible focus, keyboard reachability, meaningful status text, reduced-motion support.
- 법적 고지 `법적 효력 없는 참고자료`는 정비사업 패널과 popup에서 명확히 읽혀야 한다.

### Accepted Debt

| Item | Location | Why accepted | Owner / Exit |
|---|---|---|---|
| Leaflet canvas/SVG geometry 자체는 screen reader에 완전한 공간 설명을 제공하지 못함 | map | 기존 지도 인프라 제약; 동일 데이터를 sidebar와 popup 텍스트로 제공 | 지도 엔진 접근성 개선 시 재검토 |
| 기존 앱 전반에 raw color utility가 남아 있음 | legacy components | 이번 작업은 정비사업 UI 범위이며 광범위 토큰 이관은 회귀 위험 | 별도 design-system consolidation 작업 |
