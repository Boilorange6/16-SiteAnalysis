# 청와대 반경 3km 산출물 QA 판정 보고서

- 판정 시각: 2026-05-20T11:09:01.545Z
- 종합 상태: **APPROVED**
- 요약: 통과 5건 / 실패 0건 / HIGH 이상 실패 0건

## 체크 결과

| ID | 항목 | 치명도 | 결과 | 상세 |
| --- | --- | --- | --- | --- |
| QA-01 | 위성지도 타일 렌더링 | HIGH | PASS | 위성지도 소스와 대표 지도/PPT 출력 파일이 모두 확인되었습니다. |
| QA-02 | 5개 POI 레이어 표시 | HIGH | PASS | 5개 필수 레이어와 대응 아이콘이 모두 존재합니다. |
| QA-03 | 오버레이 좌표 정합성 | HIGH | PASS | 중심좌표와 개별 오버레이 좌표가 모두 검증 범위 내입니다. |
| QA-04 | PPT 출력 완결성 | HIGH | PASS | 실제 PPT/PDF 출력물과 7장 슬라이드 구성이 디자인 사양과 일치합니다. |
| QA-05 | 데모 시나리오 재현성 | MEDIUM | PASS | 격리 경로 실행 결과가 기존 JSON과 바이트 단위로 일치합니다. |

## 주요 판단

### QA-01 위성지도 타일 렌더링
- 결과: PASS (HIGH)
- 상세: 위성지도 소스와 대표 지도/PPT 출력 파일이 모두 확인되었습니다.
- 증적: `{"satelliteSource":"mapbox://styles/mapbox/satellite-streets-v12","outputFiles":["D:\\v-coding\\16-SiteAnalysis\\output\\map-satellite.png","D:\\v-coding\\16-SiteAnalysis\\output\\청와대_사이트분석.pptx"]}`

### QA-02 5개 POI 레이어 표시
- 결과: PASS (HIGH)
- 상세: 5개 필수 레이어와 대응 아이콘이 모두 존재합니다.
- 증적: `{"missingLayerTypes":[],"missingIcons":[]}`

### QA-03 오버레이 좌표 정합성
- 결과: PASS (HIGH)
- 상세: 중심좌표와 개별 오버레이 좌표가 모두 검증 범위 내입니다.
- 증적: `{"center":{"lat":37.5866,"lng":126.9748},"coordinateCollections":[{"type":"subways","itemCount":27,"hasCoordinates":true},{"type":"mountains","itemCount":5,"hasCoordinates":true},{"type":"schools","itemCount":24,"hasCoordinates":true},{"type":"parks","itemCount":13,"hasCoordinates":true},{"type":"apartments","itemCount":8,"hasCoordinates":true}]}`

### QA-04 PPT 출력 완결성
- 결과: PASS (HIGH)
- 상세: 실제 PPT/PDF 출력물과 7장 슬라이드 구성이 디자인 사양과 일치합니다.
- 증적: `{"slideCount":7,"expectedSlides":7,"outputFiles":["D:\\v-coding\\16-SiteAnalysis\\output\\test-ppt.pptx","D:\\v-coding\\16-SiteAnalysis\\output\\청와대_사이트분석.pptx"],"designMentionsExpectedSlides":true}`

### QA-05 데모 시나리오 재현성
- 결과: PASS (MEDIUM)
- 상세: 격리 경로 실행 결과가 기존 JSON과 바이트 단위로 일치합니다.
- 증적: `{"expectedSha256":"e4851486c1b8a4acf6de11da5a83a2a566b91e357af1612b868c373978d9ffd7","actualSha256":"e4851486c1b8a4acf6de11da5a83a2a566b91e357af1612b868c373978d9ffd7","generatedJsonPath":"C:\\Users\\impjy\\AppData\\Local\\Temp\\cheongwadae-qa-iYT3Zy\\output\\cheongwadae-analysis.json"}`
