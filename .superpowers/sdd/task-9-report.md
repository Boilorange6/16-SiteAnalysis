# Task 9 Implementation Report

Date: 2026-07-22 (Asia/Seoul)

Commits:

- `9b540f7` — `test: 정비사업 데이터 릴리스 검증 추가`
- `6683345` — `docs: 전국 정비사업 실원천 QA 상태 기록`

## Delivered

- Strict release validator for schema v1, positive output, reconciled input/output/quarantine counts, Korea WGS84 metadata/feature bbox and every coordinate, feature provenance, public artifact exclusion, ignored raw/processed paths, empty `git ls-files data/maintenance`, and client key/direct keyed-call exclusion.
- Offline `test:maintenance` gate uses a conspicuously labeled synthetic structural fixture. `qa:maintenance:release` remains strict against `data/maintenance/processed` and fails when the licensed artifact is absent.
- Failure-mode QA for missing key, missing/malformed artifact, stale attribute cache with synthetic 403, missing Seoul key/no sample, and >20% replacement guard.
- Seoul/Busan transport failures now throw `RegionalProviderRequestError` without retaining request URLs or keys in `message`/`stack`; synthetic sentinel regressions cover both providers.
- Operations guide and honest real-source summary distinguish live national attributes, synthetic UI/PPT structure evidence, and unavailable real polygons.

## TDD Evidence

Validator RED:

```text
ERR_MODULE_NOT_FOUND: qa/maintenance-data-validation.mjs
exit 1
```

Validator GREEN:

```text
maintenance release validator tests passed
exit 0
```

Regional transport RED (synthetic sentinel only):

```text
AssertionError: true !== false
src/scripts/test-maintenance-orchestration.mjs:88
exit 1
```

Regional transport GREEN:

```text
maintenance orchestration tests passed
exit 0
```

## Automatic Gates

| Command | Exit | Result |
|---|---:|---|
| `npx tsx qa/test-validate-maintenance-data.mjs` | 0 | validator unit + isolated repository CLI E2E PASS |
| `npx tsx qa/test-maintenance-failure-modes.mjs` | 0 | missing/malformed/stale+403 PASS |
| `npx tsx src/scripts/test-maintenance-orchestration.mjs` | 0 | four-source, no-sample, transport sentinel PASS |
| `npm run test:maintenance` | 0 | all maintenance tests + offline validator PASS |
| `npm run lint` | 0 | `tsc --noEmit` PASS |
| `npm run build` (run alone) | 0 | compiled, 20/20 static pages, production build PASS |
| `npm test` | 1 | pre-existing `qa/validate-cheongwadae-deliverable.mjs` returned `overallStatus: CONDITIONAL_HOLD` after analysis smoke and Cheongwadae generation |
| `npm run qa:maintenance:release` | 1 | expected strict block: `MISSING_ARTIFACT` for `data/maintenance/processed/boundaries.geojson` |

One initial `npm run build` was launched concurrently with `npm test`; it compiled/typechecked, then transiently failed prerendering `/404` because `/_document` could not be resolved. No worktree Next process remained, the generated file and manifest mapping existed, and a source-unchanged isolated build passed. Final release guidance runs build serially.

## Real-Source Evidence

No key or licensed geometry is stored here.

- National provider live check before key exposure stop: start `2026-07-22T08:11:16.522Z`, complete `2026-07-22T08:11:17.267Z`; integrated 1,566, standard 0.
- Region counts: Seoul 644, Busan 227, Daejeon 72.
- Public official CSV re-fetch: `2026-07-22T08:12:23.720Z`, 123,933 bytes, 1,566 data rows, SHA-256 `0fa3fbd498fbb45502e0d47190a6b9800ca56055639b0c76e10ca9f224815eb6`; counts match the API.
- Target-district official rows were rechecked from the public CSV: Jongno `신영제1` (199), Suyeong `광안2` (1,233), Daejeon Jung-gu `대사동1` (1,080).
- VWorld `30336`: Seoul fileNo 2, Busan 3, Daejeon 7; each page value is data date `2026-07`, updated `2026-07-19`.
- Unauthenticated `downloadResourceFile.do` returned HTTP 200 and 0 bytes for all three. Both `30335` and `30336` page scripts require login. No empty response was saved or processed.
- `SEOUL_OPEN_API_KEY` was absent. Busan detail returned HTTP 403 before the exposure stop.

During the Busan live check, ky's unhandled transport exception printed a keyed request URL to tool output. No repository file contains it, process environment cleanup ran, all further live calls stopped, and key rotation is required. The regression fix uses synthetic sentinels only. Live checks were not rerun after exposure.

## Failure Modes

| Scenario | Evidence | Outcome |
|---|---|---|
| missing data key | `qa/test-maintenance-failure-modes.mjs` | attributes error, no sample |
| missing artifact | failure-mode + orchestration | boundary failure; catalog retained after region resolution |
| malformed artifact JSON | failure-mode | typed `MALFORMED`, process survives |
| expired attributes + synthetic 403 | failure-mode | `cached`, old `fetchedAt` retained |
| missing Seoul key | orchestration | `maintenance_seoul=failed`, no sample ID |
| >20% output delta | boundary build test | replacement blocked without accepted override |
| Seoul/Busan transport 403 | orchestration sentinel | message/stack contain neither sentinel nor provider host |

## Containment Evidence

- `git ls-files data/maintenance`: empty.
- `git check-ignore -v`: raw and processed probes match `.gitignore` lines 12–13.
- Client source scan (`src/components`, non-API `src/app`): no key name, `serviceKey`, or data.go.kr call.
- `.next/static` scan: no key name or `serviceKey` token.
- Release validator finds no relative maintenance boundary artifact under `public/`.
- Baseline dirty Cheongwadae artifacts were not staged or reverted. Untracked `.playwright-cli/` was not created or modified by Task 9.

## File Hashes and Size

| File | SHA-256 | Pure / total LOC |
|---|---|---:|
| `qa/maintenance-data-validation.mjs` | `7be601ea25f0cd84902d9e44d18a189f45e0a56309526d7172e9568483072159` | 119 / 131 |
| `qa/validate-maintenance-data.mjs` | `3337939ca44a40f89b0f52060d294a75a3723dbc2317a6b77b53b3da4c697316` | 108 / 119 |
| `qa/test-validate-maintenance-data.mjs` | `61d5f00b09ab02534a8da41fc4b519a071fb837e505a8b7f156543ece66c5568` | 132 / 157 |
| `qa/test-maintenance-failure-modes.mjs` | `48255f6d5de169a38f47803af7162a1ca51a9bb5f14279442b8543fb210b6cce` | 53 / 64 |
| `src/lib/server/maintenance/regional-provider.ts` | `905fd0ffef2072616b8248c115e210e9b69d489315af88fc52ae526ede60c43d` | 219 / 239 |
| `src/scripts/test-maintenance-orchestration.mjs` | `46a8c99e7e5a3cf0c3838b57d500974842f21de8bca2f4a3b9c4b3bc729b530a` | 240 / 261 |
| `docs/maintenance-data-operations.md` | `406399717fc4ff2b363df0666db77462a0e5cf4678a43da0a44c7851561cd07e` | 55 / 89 |
| `qa/artifacts/maintenance/qa-summary.md` | `6bf30d86e8b0ab449144d317e324ac0df0bb5e33a80f4fe3bfe377f32cb63e68` | 58 / 91 |

Synthetic fixture hashes:

- GeoJSON: `0daac04b123c6ff900f64c99734a7512413b888d77f819b0718f8c930a6c6241`
- metadata: `fc2ab90bfd2db0b9ac6dff4ccc1309dc46e647fa97226ba62fe1168325957627`
- quarantine: `37517e5f3dc66819f61f5a7bb8ace1921282415f10551d2defa5c3eb0985b570`

## Remaining External Blockers

1. Rotate the exposed data.go.kr key before any further live call.
2. Obtain authenticated official `30335`/`30336` ZIPs and create provenance sidecars.
3. Build the real artifact, pass `qa:maintenance:release`, then generate three-location real desktop/mobile/popup/sidebar and PPT evidence.
4. Provide a Seoul Open Data key if live Seoul enrichment is required.

No real polygon, real three-location screenshot, or real PPT claim is made by this task.
