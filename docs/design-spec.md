# Site Analysis MVP: Design System & Visual Guidelines

## 1. Visual Tone & Color Palette
MVP를 위한 디자인 톤앤매너는 "신뢰감(Report-Grade)"과 "가독성(Legibility)"을 최우선으로 합니다. 위성지도라는 복잡한 시각적 배경 위에서 각 정보가 명확히 구분되어야 하므로 대비가 강한 네이비+화이트 톤을 기조로 사용합니다.

### 1.1 Core Palette
- **Primary Navy:** `#1E3A8A` (주요 UI 요소, 텍스트, 아파트 마커 기본 톤)
- **Secondary Navy:** `#3B82F6` (인터랙션 피드백, 액티브 상태)
- **Pure White:** `#FFFFFF` (지도 위 가독성을 위한 마커/아이콘 배경 및 아이콘 선 색상)
- **Overlay Dark:** `#0F172A` (지도 위 텍스트/도형 반투명 배경용 다크 톤)
- **Overlay Light:** `#F8FAFC` (반투명 배경용 라이트 톤)

### 1.2 POI Specific Colors
위성지도 위에서 구분이 용이하도록 각 카테고리별 포인트 컬러를 지정합니다.
- **아파트(Apartment):** `#EF4444` (Red 계열 - 가장 돋보여야 하는 정보)
- **지하철(Subway):** `#F59E0B` (Amber/Yellow 계열 - 눈에 잘 띄는 대중교통)
- **학교(School):** `#3B82F6` (Blue 계열 - 교육/공공 인프라)
- **공원/산(Park/Mountain):** `#10B981` (Green 계열 - 자연 환경)

---

## 2. Iconography & Marker System (POI)
모든 아이콘은 24px (기본/작은 해상도용) 및 48px (고해상도/강조용) 두 가지 사이즈로 대응 가능하도록 SVG 벡터로 제작합니다. 네이비+화이트 톤을 기본으로 하되, 위 컬러 시스템을 적용해 변형할 수 있습니다.

- **디자인 스타일:** Solid/Filled 스타일 뱃지 형태 (위성지도 위 선형(Line) 아이콘은 묻힐 위험이 있음). 흰색 원형 배경(Stroke 포함) 위에 네이비/포인트 컬러 아이콘 배치.
- **아파트 마커:** 텍스트(세대수/단지명)가 포함될 수 있는 말풍선(Tooltip) 또는 핀(Pin) 형태의 콤비네이션 마커 디자인.

### 2.1 가독성 확보를 위한 반투명 배경 처리 가이드라인 (Semi-transparent Overlay Guidelines)
위성지도의 복잡하고 다양한 명도/채도 배경 위에서 텍스트와 도형이 명확하게 보이도록 반드시 다음 가이드를 따릅니다.

1. **블러 효과 (Background Blur / Backdrop Filter):**
   - 텍스트가 배치되는 패널이나 말풍선의 배경은 `backdrop-filter: blur(8px)` 이상을 적용하여 뒤쪽 지도의 디테일을 뭉개줍니다.
2. **반투명 레이어 (Opacity/Alpha):**
   - **다크 테마 오버레이:** `rgba(15, 23, 42, 0.7)` (블랙/네이비 계열 70% 불투명도). 주로 흰색 텍스트와 함께 사용.
   - **라이트 테마 오버레이:** `rgba(255, 255, 255, 0.85)` (화이트 계열 85% 불투명도). 주로 네이비 텍스트와 함께 사용.
3. **Drop Shadow (그림자):**
   - 지도와 요소 사이의 깊이감을 분리하기 위해 `box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3)` 강한 섀도우를 필수로 적용.
4. **Text Outline (텍스트 스트로크):**
   - 마커 밖으로 텍스트가 노출되어야만 하는 경우, 텍스트에 최소 2px 두께의 흰색 또는 검은색 `text-shadow` 나 `stroke`를 추가하여 외곽선을 형성.

---

## 3. PPT Slide Master Layout Template
PPT Export 시 사용할 마스터 레이아웃 시안입니다.

### 3.1 Layout Grid & Specs
- **비율:** 16:9 (1920x1080px 기준)
- **여백 (Margins):** Top 80px, Bottom 60px, Left/Right 80px
- **폰트 (Typography):** 보고서에 적합한 본고딕(Noto Sans KR) 또는 맑은고딕 사용.
  - Title: 32pt, Bold, `#1E3A8A`
  - Subtitle: 20pt, Medium, `#475569`
  - Body: 14~16pt, Regular, `#334155`

### 3.2 Slide Master Components
1. **Header (상단 영역):**
   - [Left] 로고 (Logo) / 프로젝트명
   - [Left] 큰 텍스트로 슬라이드 타이틀 (ex: "반경 2km 아파트 분양 현황")
   - [Right] 기준일자 / 생성일시 / 범위 (ex: "2026.04.15 | 기준반경: 2km")
   - 하단에 2px 두께의 네이비 실선 가로선으로 본문 영역과 분리.
2. **Body (중앙 지도/데이터 영역):**
   - 지도를 풀사이즈 배경으로 깔고, 위에 반투명 정보 패널(위 가이드라인 참고)을 얹는 **Full-bleed Map** 방식 선호.
   - 우측이나 좌측 하단에 `범례(Legend)` 박스 배치 (반투명 라이트 오버레이).
3. **Footer (하단 영역):**
   - [Right] 페이지 번호 (ex: "1 / 7")
   - [Left] 데이터 출처 명시 (ex: "지도 데이터: Mapbox | 시설 데이터: 공공데이터포털")
