import type { MaintenanceCatalogProject, MaintenanceProject } from "@/lib/types";
import { formatDistanceM } from "@/lib/park-analysis";
import { formatMaintenanceArea, summarizeMaintenanceProjects } from "@/lib/maintenance-analysis";
import { maintenanceBoundaryLabel, maintenanceSourceLabel } from "@/lib/maintenance-map-utils";

interface MaintenanceSidebarPanelProps {
  readonly projects: readonly MaintenanceProject[];
  readonly catalog: readonly MaintenanceCatalogProject[];
}

function MetricTile({ label, value }: { readonly label: string; readonly value: string | number }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.06] p-3 text-center">
      <p className="truncate text-lg font-black leading-none text-[#EC4899]">{value}</p>
      <p className="mt-1 text-[9px] font-bold uppercase tracking-wide text-white/45">{label}</p>
    </div>
  );
}

function CountList({ label, entries }: { readonly label: string; readonly entries: readonly [string, number][] }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/40">{label}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {entries.length > 0 ? entries.map(([name, count]) => (
          <span key={name} className="rounded-full border border-white/10 bg-white/[0.05] px-2 py-1 text-[10px] text-white/65">
            {name} {count}건
          </span>
        )) : <span className="text-[11px] text-white/45">미확인</span>}
      </div>
    </div>
  );
}

function ProjectCard({ project }: { readonly project: MaintenanceProject }) {
  const households = project.planned_households && project.planned_households > 0
    ? `${project.planned_households.toLocaleString()}세대`
    : "미확인";
  return (
    <li className="rounded-xl border border-white/10 bg-white/[0.045] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-[13px] font-bold leading-5 text-white">{project.name}</p>
          <p className="mt-0.5 text-[11px] leading-4 text-white/55">{project.type || "정비사업"} · {project.stage}</p>
        </div>
        <span className="shrink-0 rounded-full border border-pink-300/20 bg-pink-400/10 px-2 py-1 text-[9px] font-bold text-pink-100">
          {maintenanceBoundaryLabel(project.boundary_status)}
        </span>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] leading-4">
        <div><dt className="inline text-white/40">시행자 </dt><dd className="inline break-words text-white/70">{project.implementer || "미확인"}</dd></div>
        <div><dt className="inline text-white/40">예정세대 </dt><dd className="inline text-white/70">{households}</dd></div>
        <div><dt className="inline text-white/40">면적 </dt><dd className="inline text-white/70">{formatMaintenanceArea(project.area_sqm)}</dd></div>
        <div><dt className="inline text-white/40">거리 </dt><dd className="inline text-white/70">{project.distance_m == null ? "미확인" : formatDistanceM(project.distance_m)}</dd></div>
      </dl>
    </li>
  );
}

function CatalogRow({ project }: { readonly project: MaintenanceCatalogProject }) {
  return (
    <li className="rounded-xl border border-dashed border-white/10 bg-black/10 p-3">
      <p className="break-words text-[12px] font-bold leading-5 text-white/80">{project.name}</p>
      <p className="mt-1 text-[11px] leading-4 text-white/50">
        {project.sido} {project.sigungu} · {project.type || "정비사업"} · {project.stage}
      </p>
      <p className="mt-1 text-[10px] leading-4 text-white/40">
        {project.implementer || "시행자 미확인"}
        {project.planned_households ? ` · ${project.planned_households.toLocaleString()}세대` : ""}
      </p>
    </li>
  );
}

export default function MaintenanceSidebarPanel({ projects, catalog }: MaintenanceSidebarPanelProps) {
  const summary = summarizeMaintenanceProjects(projects);
  const typeEntries = Object.entries(summary.typeCounts).sort((left, right) => right[1] - left[1]);
  const stageEntries = Object.entries(summary.stageCounts).filter((entry) => entry[1] > 0);
  const sources = [...new Set([...projects.map((project) => project.source), ...catalog.map((project) => project.source)])];
  const dates = [...projects.map((project) => project.source_updated_at), ...catalog.map((project) => project.source_updated_at)]
    .filter((date): date is string => Boolean(date))
    .sort();
  const latestDate = dates.at(-1) ?? "미확인";

  return (
    <section aria-labelledby="maintenance-panel-heading" className="rounded-2xl border border-white/10 bg-[#0F172A]/30 p-4 shadow-inner shadow-black/10">
      <div className="mb-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-blue-200/60">Pipeline</p>
        <h2 id="maintenance-panel-heading" className="mt-1 text-sm font-bold text-white">개발/정비사업</h2>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
        <MetricTile label="사업 수" value={summary.count} />
        <MetricTile label="예정세대수" value={summary.totalPlannedHouseholds > 0 ? summary.totalPlannedHouseholds.toLocaleString() : "-"} />
        <MetricTile label="총 면적" value={formatMaintenanceArea(summary.totalAreaSqm)} />
        <MetricTile label="공식 경계 수" value={summary.boundaryConfirmedCount} />
      </div>

      <div className="mt-3 space-y-3">
        <CountList label="유형" entries={typeEntries} />
        <CountList label="단계" entries={stageEntries} />
      </div>

      <div className="mt-4">
        <h3 className="text-xs font-bold text-white/80">반경 내 사업 상세</h3>
        {summary.topProjects.length > 0 ? (
          <ul className="mt-2 space-y-2">{summary.topProjects.map((project) => <ProjectCard key={project.id} project={project} />)}</ul>
        ) : (
          <p className="mt-2 text-[11px] leading-5 text-white/50">반경 내 좌표가 확인된 정비사업이 없습니다.</p>
        )}
      </div>

      <div className="mt-4 border-t border-white/10 pt-4">
        <h3 className="text-xs font-bold text-white/80">행정구역 수준 목록</h3>
        <p className="mt-1 text-[11px] leading-5 text-white/50">좌표가 없어 반경 지표와 지도 표시에 포함하지 않은 공식 목록입니다.</p>
        {catalog.length > 0 ? (
          <ul className="mt-2 space-y-2">{catalog.map((project) => <CatalogRow key={project.id} project={project} />)}</ul>
        ) : (
          <p className="mt-2 text-[11px] text-white/40">해당 행정구역의 좌표 미확인 목록이 없습니다.</p>
        )}
      </div>

      <footer className="mt-4 border-t border-white/10 pt-3 text-[10px] leading-4 text-white/45">
        <p>출처: {sources.length > 0 ? sources.map(maintenanceSourceLabel).join(" · ") : "미확인"}</p>
        <p>기준일: {latestDate}</p>
        <p className="mt-1 font-semibold text-amber-100/75">법적 효력 없는 참고자료</p>
      </footer>
    </section>
  );
}
