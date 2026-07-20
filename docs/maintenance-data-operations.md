# 정비사업 데이터 운영 절차

## 입력물과 비밀값

- 공공데이터포털 키는 로컬 또는 배포 환경의 `DATA_GO_KR_API_KEY`에만 설정한다. 서울 열린데이터광장 키는 `SEOUL_OPEN_API_KEY`에 설정한다. `.env.example`에는 이름만 보관하며 실제 키는 절대 Git에 추가하지 않는다.
- 사용 권한을 확인한 SHP ZIP만 `data/maintenance/raw/`에 배치한다. 원본 ZIP과 처리 결과는 라이선스 입력물이므로 Git에 추가하지 않는다.
- 키 회전(key rotation) 시에는 제공자 콘솔에서 기존 키를 폐기한 뒤 환경 변수 값을 갱신하고, 배포 환경을 재시작한다. 키가 없거나 호출이 실패하면 해당 데이터 소스는 `failed` 상태를 보고하며 샘플을 생성하거나 반환하지 않는다. 특히 `SEOUL_OPEN_API_KEY`가 없으면 `maintenance_seoul`은 `failed`여야 한다.

## 경계 빌드

```powershell
npm run build:maintenance-boundaries -- --input data/maintenance/raw --output data/maintenance/processed
```

빌드는 아래 산출물을 `data/maintenance/processed/`에 생성한다.

- `boundaries.geojson`: 서버가 읽는 정비사업 경계 GeoJSON
- `boundaries.meta.json`: 입력, 출력, 검역 수를 포함한 메타데이터
- `boundaries.quarantine.json`: 유효하지 않거나 처리하지 못한 feature의 검역 보고서

직전 승인 산출물과 비교해 건수 변화가 20%를 넘으면 원본, 라이선스, 필터 조건을 검토한다. 변경이 확인되고 승인된 경우에만 `--accept-large-change`를 붙여 다시 실행한다.

## 배포와 표시

- 서버에는 검증된 처리 산출물만 artifact로 배포한다. 원본 ZIP, API 키, 검역 입력물은 배포 artifact에 포함하지 않는다.
- `public/`에는 원본 또는 처리 GeoJSON을 배치하지 않는다. 경계는 서버 전용 경로에서 읽어 필요한 응답으로만 제공한다.
- 서비스와 보고서에는 출처별 요구되는 저작자 표시(attribution)를 유지하고, 정비사업 정보가 `법적 효력 없는 참고자료`임을 명시한다.
