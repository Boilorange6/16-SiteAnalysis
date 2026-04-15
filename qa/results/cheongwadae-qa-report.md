# 청와대 반경 3km 산출물 QA 판정 보고서

- 판정 시각: 2026-04-15T01:08:46.662Z
- 종합 상태: **CONDITIONAL_HOLD**
- 요약: 통과 2건 / 실패 3건 / HIGH 이상 실패 3건

## 체크 결과

| ID | 항목 | 치명도 | 결과 | 상세 |
| --- | --- | --- | --- | --- |
| QA-01 | 위성지도 타일 렌더링 | HIGH | FAIL | 위성지도 소스가 아직 pending_selection이며, 실제 PPT/PDF/슬라이드 이미지 출력물이 없습니다. |
| QA-02 | 5개 POI 레이어 표시 | HIGH | PASS | 5개 필수 레이어와 대응 아이콘이 모두 존재합니다. |
| QA-03 | 오버레이 좌표 정합성 | HIGH | FAIL | 중심좌표는 존재하지만 개별 오버레이 좌표 목록이 없어 반경 3km 정합성 검증이 불가능합니다. |
| QA-04 | PPT 출력 완결성 | HIGH | FAIL | 디자인 사양은 6장을 요구하지만 현재 JSON은 4장만 정의하고 있으며 실제 PPT/PDF 출력물도 없습니다. |
| QA-05 | 데모 시나리오 재현성 | MEDIUM | PASS | 격리 경로 실행 결과가 기존 JSON과 바이트 단위로 일치합니다. |

## 주요 판단

### QA-01 위성지도 타일 렌더링
- 결과: FAIL (HIGH)
- 상세: 위성지도 소스가 아직 pending_selection이며, 실제 PPT/PDF/슬라이드 이미지 출력물이 없습니다.
- 증적: `{"satelliteSource":"pending_selection","outputFiles":[]}`

### QA-02 5개 POI 레이어 표시
- 결과: PASS (HIGH)
- 상세: 5개 필수 레이어와 대응 아이콘이 모두 존재합니다.
- 증적: `{"missingLayerTypes":[],"missingIcons":[]}`

### QA-03 오버레이 좌표 정합성
- 결과: FAIL (HIGH)
- 상세: 중심좌표는 존재하지만 개별 오버레이 좌표 목록이 없어 반경 3km 정합성 검증이 불가능합니다.
- 증적: `{"center":{"lat":37.5866,"lng":126.9748},"coordinateCollections":[{"type":"subways","itemCount":0,"hasCoordinates":false},{"type":"mountains","itemCount":0,"hasCoordinates":false},{"type":"schools","itemCount":0,"hasCoordinates":false},{"type":"parks","itemCount":0,"hasCoordinates":false},{"type":"apartments","itemCount":0,"hasCoordinates":false}]}`

### QA-04 PPT 출력 완결성
- 결과: FAIL (HIGH)
- 상세: 디자인 사양은 6장을 요구하지만 현재 JSON은 4장만 정의하고 있으며 실제 PPT/PDF 출력물도 없습니다.
- 증적: `{"slideCount":4,"expectedSlides":6,"outputFiles":[]}`

### QA-05 데모 시나리오 재현성
- 결과: PASS (MEDIUM)
- 상세: 격리 경로 실행 결과가 기존 JSON과 바이트 단위로 일치합니다.
- 증적: `{"expectedSha256":"a3c028672f0d8d65786427c50722902264e0680a10bb8e862e2c01eb113042ee","actualSha256":"a3c028672f0d8d65786427c50722902264e0680a10bb8e862e2c01eb113042ee","generatedJsonPath":"C:\\Users\\impjy\\AppData\\Local\\Temp\\cheongwadae-qa-6EApM4\\output\\cheongwadae-analysis.json"}`

## QA 결론

- 조건부 승인 유지. 실제 위성지도 출력물 부재, 개별 좌표 부재, PPT 완성본 부재로 인해 최종 승인 기준을 충족하지 못했습니다.
- 재검토 전 필수 보완: 위성지도 소스 확정 및 출력물 첨부, 레이어별 좌표 리스트 제공, 6장 구성의 실제 PPT/PDF 생성.
