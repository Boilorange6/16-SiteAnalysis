import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { guideTileGroups, guideTiles } from "@/lib/v2/ui/guide-catalog";
import { readGuideSourceSnapshot, type GuideSourceRelease } from "@/lib/v2/ui/guide-sources";
import { cleanSourceText, sourceName } from "@/lib/v2/ui/tile-catalog";
import { sourceOps } from "@/lib/v2/ui/source-details";
import { NEIGHBORHOOD_REFERENCE, RADIUS_OPTIONS } from "@/lib/v2/ui/radius-options";
import styles from "./guide.module.css";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "가이드·데이터 출처 | 사이트 분석",
  description: "주소와 반경으로 사이트 분석 보드를 읽고, 데이터 출처와 해석 한계를 확인하는 가이드입니다.",
};

const BADGE_GUIDE = [
  { label: "추정", tone: "estimate", description: "공개 자료나 모델로 계산한 값입니다. 확인값과 섞어 읽지 않습니다." },
  { label: "미확인", tone: "unknown", description: "자료가 없거나 상태를 확인할 수 없어 빈칸을 관측값으로 채우지 않습니다." },
  { label: "일부 자료만 집계", tone: "partial", description: "원천·지역·기간의 일부만 확보된 결과입니다. 전체 합계로 확대 해석하지 않습니다." },
] as const;

function dateFromRelease(row: GuideSourceRelease): string {
  if (row.sourceAsOf) return row.sourceAsOf;
  const match = /@(\d{4}(?:-\d{2}){0,2}|\d{8})$/.exec(row.releaseId);
  if (!match) return "기준일 미기록";
  const value = match[1];
  return /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}` : value;
}

function dateOnly(value: string | null): string {
  return value ? value.slice(0, 10) : "미기록";
}

function updateCycle(row: GuideSourceRelease): string {
  for (const key of ["updateCycle", "update_cycle", "refreshCycle", "refresh_cycle", "frequency"]) {
    const value = row.rights[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return sourceOps(row.sourceId).cycle ?? "갱신 주기 미기록";
}

function providerLabel(row: GuideSourceRelease): string {
  return cleanSourceText(row.provider || sourceName(row.sourceId)) || sourceName(row.sourceId);
}

function fallbackSourceRows(sourceIds: string[]): GuideSourceRelease[] {
  return sourceIds.map((sourceId) => ({
    sourceId,
    releaseId: "catalog",
    provider: sourceName(sourceId),
    sourceUrl: "",
    sourceAsOf: null,
    publishedAt: null,
    fetchedAt: "",
    licenseCode: "라이선스 미기록",
    rights: {},
    fileKey: "catalog",
  }));
}

function sourceIdsFromCatalog(): string[] {
  return [...new Set(guideTiles().flatMap((tile) => tile.sources))].sort((a, b) => sourceName(a).localeCompare(sourceName(b)) || a.localeCompare(b));
}

function sourceStateText(snapshot: ReturnType<typeof readGuideSourceSnapshot>): string {
  if (snapshot.rows.length > 0) {
    return `현재 게시 자료 목록${snapshot.manifestVersion ? ` ${snapshot.manifestVersion}` : ""}에서 출처 정보를 읽었습니다. 기준일은 원천별로 다를 수 있습니다.`;
  }
  if (snapshot.manifestVersion) {
    return `게시 자료 목록 ${snapshot.manifestVersion}는 확인했지만 출처 정보를 읽지 못했습니다. 아래 표는 카탈로그 원천 기준이며 기준일은 각 타일 출처 줄을 참조하세요.`;
  }
  return "게시 자료 목록을 읽을 수 없어 카탈로그 원천 기준으로 표시합니다. 기준일은 각 타일의 출처 줄을 참조하세요.";
}

export default function GuidePage() {
  const groups = guideTileGroups();
  const snapshot = readGuideSourceSnapshot();
  const sourceRows = snapshot.rows.length > 0 ? snapshot.rows : fallbackSourceRows(sourceIdsFromCatalog());

  return (
    <div className={styles.root}>
      <a className={styles.skipLink} href="#guide-content">본문으로 건너뛰기</a>
      <div className={styles.page}>
        <header className={styles.topbar}>
          <div className={styles.brandCluster}>
            <a className={styles.backLink} href="/site/v2">← 보드</a>
            <span className={`${styles.display} ${styles.brand}`}>사이트 분석</span>
            <span className={styles.currentLabel}>가이드·출처</span>
          </div>
          <nav className={styles.nav} aria-label="가이드 목차">
            <a href="#how-to">사용 방법</a>
            <a href="#tiles">타일 목록</a>
            <a href="#sources">데이터 출처</a>
            <a href="#limits">한계와 해석</a>
          </nav>
        </header>

        <main id="guide-content">
          <section className={styles.hero} aria-labelledby="guide-title">
            <div className={styles.heroCopy}>
              <p className={styles.eyebrow}>SITE ANALYSIS / GUIDE</p>
              <h1 id="guide-title">주소에서 보고서까지,<br /><em>보드를 읽는 순서</em></h1>
              <p className={styles.heroLead}>
                부동산·개발 검토자가 주소 하나로 주변 조건을 훑고, 타일을 골라 읽고, 편집 가능한 산출물로 넘기는 방법을 정리했습니다.
              </p>
              <div className={styles.heroActions}>
                <a className={styles.primaryAction} href="#how-to">사용 방법 보기</a>
                <a className={styles.secondaryAction} href="#sources">출처 확인하기</a>
              </div>
            </div>
            <aside className={styles.heroPanel} aria-label="가이드 요약">
              <p className={styles.panelLabel}>QUICK READ</p>
              <p className={styles.heroPanelTitle}>분석은 네 단계입니다.</p>
              <ol className={styles.quickList}>
                <li><span>01</span>주소와 반경을 정합니다.</li>
                <li><span>02</span>헤드라인과 배지를 먼저 봅니다.</li>
                <li><span>03</span>뒷면 구성비와 펼침을 확인합니다.</li>
                <li><span>04</span>PPT·DXF·3D로 이어갑니다.</li>
              </ol>
            </aside>
          </section>

          <section id="how-to" className={styles.section} aria-labelledby="how-title">
            <div className={styles.sectionHeading}>
              <p className={styles.eyebrow}>01 / USE THE BOARD</p>
              <h2 id="how-title">사용 방법</h2>
              <p>처음에는 전체 보드를 빠르게 훑고, 의사결정에 필요한 타일만 펼쳐 세부 근거를 확인하세요.</p>
            </div>

            <ol className={styles.stepGrid}>
              <li className={styles.stepCard}>
                <span className={styles.stepNumber}>01</span>
                <h3>주소 입력</h3>
                <p>지번 주소를 입력합니다. 분석 중심점과 대상 필지를 찾기 때문에 도로명 주소가 아닌 지번 기준으로 시작합니다.</p>
                <span className={styles.example}>예: 서울 강동구 고덕동 123</span>
              </li>
              <li className={styles.stepCard}>
                <span className={styles.stepNumber}>02</span>
                <h3>반경 선택</h3>
                <p>목적에 맞는 원형 반경을 고릅니다. 반경은 도보 시간이나 행정구역이 아니라 분석 중심점에서의 직선 거리입니다.</p>
                <div className={styles.radiusPanel}>
                  <p className={styles.miniLabel}>현재 앱 선택값</p>
                  <ul className={styles.radiusList}>
                    {RADIUS_OPTIONS.map((radius) => (
                      <li key={radius.label}>
                        <strong>{radius.label}</strong>
                        <span>{radius.purpose}</span>
                      </li>
                    ))}
                  </ul>
                  <p className={styles.radiusNote}><strong>{NEIGHBORHOOD_REFERENCE.label} · {NEIGHBORHOOD_REFERENCE.purpose}</strong>는 실무 해석 기준입니다. 현재 반경 선택 메뉴에는 포함되지 않습니다.</p>
                </div>
              </li>
              <li className={styles.stepCard}>
                <span className={styles.stepNumber}>03</span>
                <h3>타일 보드 읽기</h3>
                <p>헤드라인으로 핵심값을 잡고, 배지로 값의 상태를 확인합니다. 지도 타일은 위치·형태를, 뒷면은 구성비를 보여 줍니다.</p>
                <ul className={styles.badgeList} aria-label="상태 배지 뜻">
                  {BADGE_GUIDE.map((badge) => (
                    <li key={badge.label}>
                      <span className={`${styles.badge} ${styles[badge.tone]}`}>{badge.label}</span>
                      <span>{badge.description}</span>
                    </li>
                  ))}
                </ul>
              </li>
              <li className={styles.stepCard}>
                <span className={styles.stepNumber}>04</span>
                <h3>펼침과 내보내기</h3>
                <p>타일의 펼침으로 지도·도판과 상세 표를 열고, 보드 순서를 편집한 뒤 보고서와 설계 도구용 파일로 내보냅니다.</p>
                <div className={styles.exportList}>
                  <span>PPT</span><span>DXF</span><span>GLB</span><span>DAE</span><span>3DM</span>
                </div>
                <p className={styles.cardFootnote}>PPT는 편집 가능한 보고서, DXF·3D는 건물·필지·대지·반경 중심 산출물입니다.</p>
              </li>
            </ol>

            <div className={styles.readingStrip}>
              <div>
                <p className={styles.miniLabel}>읽는 순서</p>
                <strong>헤드라인 → 배지 → 지도/도판 → 뒷면 구성비 → 펼침 상세</strong>
              </div>
              <p>값 하나보다 원천, 기준일, 누락 상태를 함께 읽어야 합니다.</p>
            </div>
          </section>

          <section id="tiles" className={styles.section} aria-labelledby="tiles-title">
            <div className={styles.sectionHeading}>
              <p className={styles.eyebrow}>02 / TILE CATALOG</p>
              <h2 id="tiles-title">타일 목록</h2>
              <p>아래 목록은 화면 카탈로그에서 코드·이름·설명·원천을 직접 읽어 생성됩니다. 타일이 추가되면 이 페이지도 같은 카탈로그를 따라갑니다.</p>
            </div>

            <div className={styles.groupStack}>
              {groups.map((group) => (
                <section key={group.kind} className={styles.tileGroup} aria-labelledby={`group-${group.kind}`}>
                  <div className={styles.groupHeading}>
                    <div>
                      <p className={styles.miniLabel}>{group.kind.toUpperCase()}</p>
                      <h3 id={`group-${group.kind}`}>{group.label}</h3>
                    </div>
                    <p>{group.note}</p>
                  </div>
                  <div className={styles.tileGrid}>
                    {group.tiles.map((tile) => (
                      <article key={tile.code} className={styles.tileCard} style={{ "--tile-color": tile.color } as CSSProperties}>
                        <div className={styles.tileCardTop}>
                          <span className={styles.tileCode}>{tile.code}</span>
                          <span className={styles.tileKind}>{tile.kind === "analysis" ? "분석" : tile.kind === "diagram" ? "도판" : "시뮬레이션"}</span>
                        </div>
                        <h4>{tile.title}</h4>
                        <p>{tile.description}</p>
                        <div className={styles.tileSources}>
                          <span className={styles.miniLabel}>원천</span>
                          <ul aria-label={`${tile.code} 원천`}>
                            {[...new Map(tile.sources.map((sourceId) => [sourceName(sourceId), sourceId])).entries()].map(([label, sourceId]) => <li key={sourceId}>{label}</li>)}
                          </ul>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </section>

          <section id="sources" className={styles.section} aria-labelledby="sources-title">
            <div className={styles.sectionHeading}>
              <p className={styles.eyebrow}>03 / PROVENANCE</p>
              <h2 id="sources-title">데이터 출처</h2>
              <p>{sourceStateText(snapshot)}</p>
            </div>

            <div className={styles.sourceMeta}>
              <span>자료 목록 확인일 <strong>{snapshot.manifestCreatedAt ? dateOnly(snapshot.manifestCreatedAt) : "미확인"}</strong></span>
              <span>표시 행 <strong>{sourceRows.length.toLocaleString("ko-KR")}</strong></span>
              <span>기준일·라이선스·갱신 주기는 원천별 메타 우선</span>
            </div>

            <div className={styles.sourceTableWrap}>
              <table className={styles.sourceTable}>
              <caption>게시 자료의 출처 정보</caption>
                <thead>
                  <tr><th scope="col">원천</th><th scope="col">제공처·자료</th><th scope="col">기준일</th><th scope="col">라이선스</th><th scope="col">갱신 주기</th><th scope="col">확인</th></tr>
                </thead>
                <tbody>
                  {sourceRows.map((row) => (
                    <tr key={`${row.sourceId}:${row.releaseId}`}>
                      <th scope="row"><span>{sourceName(row.sourceId)}</span></th>
                      <td>{row.sourceUrl && /^https?:\/\//.test(row.sourceUrl) ? <a href={row.sourceUrl} target="_blank" rel="noreferrer">{providerLabel(row)}</a> : providerLabel(row)}</td>
                      <td>{dateFromRelease(row)}</td>
                      <td>{row.licenseCode || "미기록"}</td>
                      <td>{updateCycle(row)}</td>
                      <td><small>{dateOnly(row.fetchedAt || null)}</small></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={styles.sourceCards}>
              {sourceRows.map((row) => (
                <article key={`${row.sourceId}:${row.releaseId}`} className={styles.sourceCard}>
                  <div className={styles.sourceCardHeading}>
                    <h3>{sourceName(row.sourceId)}</h3>
                  </div>
                  <p>{row.sourceUrl && /^https?:\/\//.test(row.sourceUrl) ? <a href={row.sourceUrl} target="_blank" rel="noreferrer">{providerLabel(row)}</a> : providerLabel(row)}</p>
                  <dl>
                    <div><dt>기준일</dt><dd>{dateFromRelease(row)}</dd></div>
                    <div><dt>라이선스</dt><dd>{row.licenseCode || "미기록"}</dd></div>
                    <div><dt>갱신 주기</dt><dd>{updateCycle(row)}</dd></div>
                    <div><dt>확인일</dt><dd>{dateOnly(row.fetchedAt || null)}</dd></div>
                  </dl>
                </article>
              ))}
            </div>
          </section>

          <section id="limits" className={styles.section} aria-labelledby="limits-title">
            <div className={styles.sectionHeading}>
              <p className={styles.eyebrow}>04 / INTERPRETATION</p>
              <h2 id="limits-title">한계와 해석 원칙</h2>
              <p>타일은 검토를 빠르게 만드는 근거 묶음이지, 현장 조사·법적 판단·실시설계를 대체하지 않습니다.</p>
            </div>
            <div className={styles.principleGrid}>
              <article className={styles.principleCard}>
                <span className={styles.principleIndex}>01</span>
                <h3>회색은 빈칸이 아닙니다</h3>
                <p><strong>추정</strong>은 계산 모델, <strong>미확인</strong>은 원천·상태 확인 실패, <strong>일부 자료만 집계</strong>는 범위가 제한된 결과입니다. 회색 상태를 확인값처럼 합치지 마세요.</p>
              </article>
              <article className={styles.principleCard}>
                <span className={styles.principleIndex}>02</span>
                <h3>반경 집계는 건물 중심점 기준</h3>
                <p>건물 수와 건물 구성비는 건물 도형의 중심점이 반경 안에 들어오는지를 기준으로 셉니다. 지도에서 반경과 겹쳐 보이는 도형 전체가 자동으로 집계되는 것은 아닙니다.</p>
              </article>
              <article className={styles.principleCard}>
                <span className={styles.principleIndex}>03</span>
                <h3>시뮬레이션은 상대 비교용</h3>
                <p>일조·바람·열쾌적 결과는 공개 자료와 단순화한 조건으로 장소 간 차이를 보는 탐색용 지표입니다. 검증된 CFD와 동등하지 않으며 인허가·구조·보행 안전 판단에 직접 쓰지 않습니다.</p>
              </article>
              <article className={styles.principleCard}>
                <span className={styles.principleIndex}>04</span>
                <h3>출처 줄을 끝까지 확인</h3>
                <p>타일의 출처·기준일은 원천마다 다릅니다. 오래된 자료, 대표점, 공개 범위, 중복 가능성을 확인하고 중요한 결론은 최신 공식 자료와 현장 검토로 교차 확인하세요.</p>
              </article>
            </div>
          </section>
        </main>

        <footer className={styles.footer}>
          <div>
            <p className={styles.eyebrow}>READY TO REVIEW?</p>
            <p className={styles.footerTitle}>주소를 넣고, 필요한 타일부터 펼쳐 보세요.</p>
          </div>
          <a className={styles.primaryAction} href="/site/v2">보드로 돌아가기</a>
        </footer>
      </div>
    </div>
  );
}
