"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/providers/auth-provider";
import { useRouter } from "next/navigation";
import { authFetch } from "@/lib/auth-fetch";
import Link from "next/link";

const API_KEY_FIELDS = [
  { key: "naver_id", label: "네이버 검색 Client ID" },
  { key: "naver_secret", label: "네이버 검색 Client Secret" },
  { key: "naver_map_id", label: "네이버 지도 Client ID (NCP)" },
  { key: "naver_map_secret", label: "네이버 지도 Client Secret (NCP)" },
] as const;

const API_KEY_GROUPS = [
  {
    title: "검색 API",
    description: "주소 검색과 장소 후보 조회에 사용됩니다.",
    keys: ["naver_id", "naver_secret"],
  },
  {
    title: "지도 API",
    description: "지도 SDK와 좌표 기반 분석을 안정적으로 표시하는 데 사용됩니다.",
    keys: ["naver_map_id", "naver_map_secret"],
  },
] as const;

const FIELD_BY_KEY = Object.fromEntries(API_KEY_FIELDS.map((field) => [field.key, field]));

export default function MyPage() {
  const { user, isLoading, logout } = useAuth();
  const router = useRouter();
  const [maskedKeys, setMaskedKeys] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/login");
    }
  }, [isLoading, user, router]);

  useEffect(() => {
    if (!user) return;
    authFetch("/site/api/user/api-keys")
      .then((res) => res.json())
      .then((data) => setMaskedKeys(data.keys || {}))
      .catch(() => {});
  }, [user]);

  async function handleSave() {
    const keysToSave: Record<string, string> = {};
    for (const { key } of API_KEY_FIELDS) {
      if (draft[key]?.trim()) {
        keysToSave[key] = draft[key].trim();
      }
    }
    if (Object.keys(keysToSave).length === 0) return;

    setSaving(true);
    setMessage("");
    try {
      const res = await authFetch("/site/api/user/api-keys", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(keysToSave),
      });
      if (res.ok) {
        const data = await res.json();
        setMaskedKeys(data.keys || {});
        setDraft({});
        setMessage("저장되었습니다.");
      } else {
        const data = await res.json();
        setMessage(data.error || "저장 실패");
      }
    } catch {
      setMessage("저장 실패");
    } finally {
      setSaving(false);
    }
  }

  if (isLoading || !user) {
    return (
      <div className="flex h-dvh items-center justify-center bg-[#0F172A]">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-blue-400 border-t-white" />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[#0F172A] px-4 py-8">
      <div className="mx-auto w-full max-w-3xl rounded-2xl border border-white/10 bg-[#1E3A8A]/82 p-6 shadow-2xl backdrop-blur-xl sm:p-8">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-blue-200/65">
              Account
            </p>
            <h1 className="mt-2 text-2xl font-black text-white">마이페이지</h1>
            <p className="mt-1 text-sm text-blue-100/70">{user.username}</p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/"
              className="rounded-full border border-white/15 px-4 py-2 text-xs font-semibold text-white/85 transition hover:bg-white/10"
            >
              돌아가기
            </Link>
            <button
              type="button"
              onClick={logout}
              className="rounded-full border border-white/15 px-4 py-2 text-xs font-semibold text-white/85 transition hover:bg-white/10"
            >
              로그아웃
            </button>
          </div>
        </div>

        <section className="rounded-2xl border border-white/10 bg-[#0F172A]/30 p-5">
          <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.25em] text-blue-200/70">
                Naver API
              </p>
              <h2 className="mt-2 text-lg font-black text-white">API 키 설정</h2>
            </div>
            <p className="text-sm text-blue-100/65">
              저장된 키 {Object.values(maskedKeys).filter(Boolean).length}/{API_KEY_FIELDS.length}
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {API_KEY_GROUPS.map((group) => {
              const configuredCount = group.keys.filter((key) => maskedKeys[key]).length;
              const complete = configuredCount === group.keys.length;

              return (
              <div key={group.title} className="rounded-2xl border border-white/10 bg-white/[0.05] p-4">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-white">{group.title}</h3>
                    <p className="mt-1 text-xs leading-5 text-blue-100/60">{group.description}</p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black ${
                      complete ? "bg-emerald-400/15 text-emerald-200" : "bg-amber-300/15 text-amber-100"
                    }`}
                  >
                    {complete ? "완료" : `${configuredCount}/${group.keys.length}`}
                  </span>
                </div>
                <div className="space-y-4">
                  {group.keys.map((key) => {
                    const field = FIELD_BY_KEY[key];
                    return (
                      <div key={key}>
                        <label
                          htmlFor={key}
                          className="text-[11px] font-semibold uppercase tracking-wide text-blue-200/65"
                        >
                          {field.label}
                        </label>
                        <input
                          id={key}
                          type="password"
                          autoComplete="off"
                          placeholder={maskedKeys[key] || "미설정"}
                          value={draft[key] || ""}
                          onChange={(e) =>
                            setDraft((prev) => ({ ...prev, [key]: e.target.value }))
                          }
                          className="mt-1 w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2.5 text-sm text-white placeholder:text-white/35 focus:outline-none focus:ring-2 focus:ring-[#93C5FD]"
                        />
                        {maskedKeys[key] && (
                          <p className="mt-1 text-[11px] text-green-300/85">
                            저장됨: {maskedKeys[key]}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              );
            })}
          </div>

          {message && (
            <p className="mt-4 rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-white/85">
              {message}
            </p>
          )}

          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-5 text-white/50">
              입력한 키는 서버에 암호화되어 저장되며 API 요청 시에만 복호화됩니다.
            </p>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || Object.values(draft).every((v) => !v?.trim())}
              className="rounded-xl bg-[#3B82F6] px-6 py-3 text-sm font-bold text-white transition hover:bg-[#2563EB] disabled:cursor-not-allowed disabled:bg-slate-600 sm:min-w-36"
            >
              {saving ? "저장 중..." : "키 저장"}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
