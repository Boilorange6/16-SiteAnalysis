"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { SiteInput } from "@/lib/v2/site";
import styles from "./board.module.css";
import { useFocusTrap } from "./use-focus-trap";

export type V2Project = {
  projectId: string;
  name: string;
  analysisId: string;
  board?: unknown;
  address: string;
  label?: string;
  radiusM: number;
  analysisDate: string;
  dataVersion: string;
  engineVersion: string;
  createdAt: string;
  updatedAt: string;
  dataVersionAvailable?: boolean;
  site?: SiteInput;
};

type ProjectMenuProps = {
  analysisId: string | null;
  currentProjectId: string | null;
  currentProjectName: string | null;
  defaultName: string;
  board: unknown | null;
  canSave: boolean;
  dirty: boolean;
  onSaved: (project: V2Project) => void;
  onDeleted: (projectId: string) => void;
  onOpenProject: (projectId: string) => void;
  onAuthExpired: () => void;
};

type MenuMode = "list" | "save" | "rename" | null;

const PROJECTS_API = "/site/api/v2/projects";

async function projectFetch(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, { ...init, credentials: "include" });
  if (res.status !== 401) return res;
  const refreshed = await fetch("/site/api/auth/refresh", { method: "POST", credentials: "include" }).then((r) => r.ok, () => false);
  return refreshed ? fetch(url, { ...init, credentials: "include" }) : res;
}

function formatAppDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).map(({ type, value: part }) => [type, part]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function formatRadius(radiusM: number): string {
  return radiusM >= 1000 ? `${radiusM / 1000}km` : `${radiusM}m`;
}

function formatDataVersion(value: string, analysisDate: string): string {
  const version = value.trim();
  return /^[0-9a-f]{8,}$/i.test(version) ? `데이터 기준일 ${analysisDate || "미확인"}` : `데이터 ${version || "미확인"}`;
}

export default function ProjectMenu({ analysisId, currentProjectId, currentProjectName, defaultName, board, canSave, dirty, onSaved, onDeleted, onOpenProject, onAuthExpired }: ProjectMenuProps) {
  const [mode, setMode] = useState<MenuMode>(null);
  const [projects, setProjects] = useState<V2Project[]>([]);
  const [name, setName] = useState(defaultName);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [saveAsNew, setSaveAsNew] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveMenuOpen, setSaveMenuOpen] = useState(false);
  const saveMenuRef = useRef<HTMLDivElement>(null);
  const saveMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useFocusTrap({ ref: dialogRef, active: mode !== null, onClose: () => setMode(null), restoreFocusRef });

  useEffect(() => {
    if (!saveMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && saveMenuRef.current?.contains(event.target)) return;
      setSaveMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSaveMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [saveMenuOpen]);

  const openList = async () => {
    setSaveMenuOpen(false);
    setMode("list");
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const res = await projectFetch(PROJECTS_API);
      const body = await res.json().catch(() => ({})) as { projects?: V2Project[]; error?: string };
      if (res.status === 401) {
        onAuthExpired();
        setError("로그인이 만료되었습니다. 다시 로그인해 주세요.");
      } else if (!res.ok) {
        setError(body.error ?? "프로젝트 목록을 불러오지 못했습니다.");
      } else {
        setProjects(Array.isArray(body.projects) ? body.projects : []);
      }
    } catch {
      setError("서버에 연결하지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const openSave = (asNew: boolean, opener?: HTMLElement | null) => {
    setSaveMenuOpen(false);
    restoreFocusRef.current = opener ?? saveMenuTriggerRef.current;
    setMode("save");
    setSaveAsNew(asNew || !currentProjectId);
    setRenameId(null);
    setName(asNew || !currentProjectName ? defaultName : currentProjectName);
    setError(null);
    setNotice(null);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSave || !board) return;
    setLoading(true);
    setError(null);
    try {
      const projectId = !saveAsNew && currentProjectId ? currentProjectId : undefined;
      const res = await projectFetch(PROJECTS_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, analysisId, board, ...(projectId ? { projectId } : {}) }),
      });
      const body = await res.json().catch(() => ({})) as { project?: V2Project; error?: string; code?: string };
      if (res.status === 401) {
        onAuthExpired();
        setError("로그인이 만료되었습니다. 다시 로그인해 주세요.");
      } else if (!res.ok || !body.project) {
        setError(body.code === "DATA_VERSION_GONE" ? "데이터가 갱신되어 다시 분석이 필요합니다." : body.error ?? "프로젝트를 저장하지 못했습니다.");
      } else {
        setProjects((current) => [body.project!, ...current.filter((item) => item.projectId !== body.project!.projectId)]);
        onSaved(body.project);
        setMode(null);
        setNotice("프로젝트를 저장했습니다.");
      }
    } catch {
      setError("서버에 연결하지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const rename = async (event: FormEvent) => {
    event.preventDefault();
    if (!renameId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await projectFetch(`${PROJECTS_API}/${encodeURIComponent(renameId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const body = await res.json().catch(() => ({})) as { project?: V2Project; error?: string };
      if (res.status === 401) {
        onAuthExpired();
        setError("로그인이 만료되었습니다. 다시 로그인해 주세요.");
      } else if (!res.ok || !body.project) {
        setError(body.error ?? "이름을 바꾸지 못했습니다.");
      } else {
        setProjects((current) => current.map((item) => item.projectId === body.project!.projectId ? { ...item, ...body.project } : item));
        onSaved(body.project);
        setMode("list");
        setNotice("프로젝트 이름을 바꿨습니다.");
      }
    } catch {
      setError("서버에 연결하지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const remove = async (project: V2Project) => {
    if (!window.confirm(`“${project.name}” 프로젝트를 삭제할까요?`)) return;
    setLoading(true);
    setError(null);
    try {
      const res = await projectFetch(`${PROJECTS_API}/${encodeURIComponent(project.projectId)}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({})) as { error?: string };
      if (res.status === 401) {
        onAuthExpired();
        setError("로그인이 만료되었습니다. 다시 로그인해 주세요.");
      } else if (!res.ok) {
        setError(body.error ?? "프로젝트를 삭제하지 못했습니다.");
      } else {
        setProjects((current) => current.filter((item) => item.projectId !== project.projectId));
        onDeleted(project.projectId);
        setNotice("프로젝트를 삭제했습니다.");
      }
    } catch {
      setError("서버에 연결하지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const editName = (project: V2Project) => {
    setRenameId(project.projectId);
    setName(project.name);
    setError(null);
    setMode("rename");
  };

  const projectBody = mode === "rename" ? (
    <form className={styles.projectForm} onSubmit={rename}>
      <label htmlFor="v2-project-name">프로젝트 이름</label>
      <input id="v2-project-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} autoFocus disabled={loading} />
      {error && <p className={styles.projectError} role="alert">{error}</p>}
      <div className={styles.projectFormActions}>
        <button type="button" className={styles.pill} onClick={() => setMode("list")} disabled={loading}>취소</button>
        <button type="submit" className={`${styles.pill} ${styles.pillDark}`} disabled={loading || !name.trim()}>{loading ? "저장 중…" : "이름 저장"}</button>
      </div>
    </form>
  ) : mode === "save" ? (
    <form className={styles.projectForm} onSubmit={save}>
      <label htmlFor="v2-project-name">프로젝트 이름</label>
      <input id="v2-project-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} autoFocus disabled={loading} />
      <p className={styles.projectHelp}>주소와 반경을 기본 이름으로 사용합니다. 같은 이름의 현재 프로젝트는 덮어씁니다.</p>
      {error && <p className={styles.projectError} role="alert">{error}</p>}
      <div className={styles.projectFormActions}>
        <button type="button" className={styles.pill} onClick={() => setMode(null)} disabled={loading}>취소</button>
        <button type="submit" className={`${styles.pill} ${styles.pillDark}`} disabled={loading || !canSave || !name.trim()}>{loading ? "저장 중…" : "저장"}</button>
      </div>
    </form>
  ) : (
    <>
      {loading && <p className={styles.projectStatus} role="status">목록을 불러오는 중…</p>}
      {error && <p className={styles.projectError} role="alert">{error} <a href="/site/login?next=%2Fsite%2Fv2">다시 로그인</a></p>}
      {!loading && !error && projects.length === 0 && <p className={styles.projectEmpty}>저장한 프로젝트가 없습니다. 분석 후 '저장'을 누르세요.</p>}
      <div className={styles.projectList}>
        {projects.map((project) => (
          <article key={project.projectId} className={styles.projectRow}>
            <div className={styles.projectMeta}>
              <h3>{project.name}</h3>
              <p>{project.address} · 반경 {formatRadius(project.radiusM)}</p>
              <p>분석일 {project.analysisDate} · {formatDataVersion(project.dataVersion, project.analysisDate)} · 수정 {formatAppDateTime(project.updatedAt)}</p>
              {project.dataVersionAvailable === false && <strong className={styles.projectStale}>데이터 갱신됨 — 다시 분석 필요</strong>}
            </div>
            <div className={styles.projectActions}>
              <button type="button" className={styles.projectAction} onClick={() => { setMode(null); onOpenProject(project.projectId); }}>열기</button>
              <button type="button" className={styles.projectAction} onClick={() => editName(project)}>이름 변경</button>
              <button type="button" className={`${styles.projectAction} ${styles.projectDelete}`} onClick={() => void remove(project)} disabled={loading}>삭제</button>
            </div>
          </article>
        ))}
      </div>
    </>
  );

  return (
    <>
      <div className={styles.projectControls}>
        <button type="button" className={styles.pill} onClick={(event) => { restoreFocusRef.current = event.currentTarget; void openList(); }}>내 프로젝트</button>
        {dirty && <span className={styles.saveDirty} role="status">저장 안 된 변경</span>}
        <div className={styles.saveSplit} ref={saveMenuRef}>
          <button type="button" className={`${styles.pill} ${styles.pillDark} ${currentProjectId ? styles.saveSplitPrimary : ""}`} onClick={(event) => openSave(false, event.currentTarget)} disabled={!canSave}>저장</button>
          {currentProjectId && (
            <>
              <button
                type="button"
                ref={saveMenuTriggerRef}
                className={`${styles.pill} ${styles.pillDark} ${styles.saveSplitTrigger}`}
                onClick={() => setSaveMenuOpen((open) => !open)}
                disabled={!canSave}
                aria-label="저장 메뉴"
                aria-expanded={saveMenuOpen}
                aria-haspopup="menu"
              >
                ▾
              </button>
              {saveMenuOpen && (
                <div className={styles.saveMenu} role="menu" aria-label="저장 메뉴">
                  <button type="button" className={styles.saveMenuItem} role="menuitem" onClick={() => openSave(true, saveMenuTriggerRef.current)}>다른 이름으로 저장</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {notice && <span className={styles.projectNotice} role="status">{notice}</span>}
      {mode !== null && (
        <div className={styles.projectOverlay} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setMode(null); }}>
          <section ref={dialogRef} className={styles.projectDialog} role="dialog" aria-modal="true" aria-labelledby="v2-project-dialog-title" tabIndex={-1}>
            <div className={styles.projectDialogHead}>
              <div>
                <p className={styles.projectKicker}>사이트 분석</p>
                <h2 id="v2-project-dialog-title">{mode === "list" ? "내 프로젝트" : mode === "rename" ? "프로젝트 이름 변경" : currentProjectId ? "프로젝트 저장" : "새 프로젝트 저장"}</h2>
              </div>
              <button type="button" className={styles.projectClose} onClick={() => setMode(null)} aria-label="프로젝트 창 닫기">×</button>
            </div>
            {projectBody}
          </section>
        </div>
      )}
    </>
  );
}
