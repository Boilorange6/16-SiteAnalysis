"use client";

import { useState, type FormEvent } from "react";
import { useAuth } from "@/providers/auth-provider";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function SignupPage() {
  const { signup } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (password !== confirm) {
      setError("비밀번호가 일치하지 않습니다.");
      return;
    }

    setLoading(true);
    try {
      await signup(username, password);
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "회원가입 실패");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#0F172A] px-4 py-8">
      <div className="w-full max-w-[440px] rounded-2xl border border-white/10 bg-[#1E3A8A]/82 p-8 shadow-[0_28px_90px_rgba(2,6,23,0.45)] backdrop-blur-xl sm:p-9">
        <div className="mb-9 text-center">
          <p className="text-xs font-bold uppercase tracking-[0.28em] text-blue-200/65">
            Report Generator
          </p>
          <h1 className="mt-3 text-3xl font-black tracking-tight text-white">
            Site Analysis
          </h1>
          <p className="mt-2 text-sm text-blue-100/70">회원가입</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6 border-t border-white/10 pt-7">
          <div>
            <label htmlFor="username" className="mb-2 block text-xs font-semibold uppercase tracking-wide text-blue-200/70">
              사용자명
            </label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              required
              minLength={3}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="block w-full rounded-xl border border-white/15 bg-white/10 px-4 py-4 text-sm text-white placeholder:text-white/35 focus:outline-none focus:ring-2 focus:ring-[#93C5FD]"
              placeholder="3자 이상"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-2 block text-xs font-semibold uppercase tracking-wide text-blue-200/70">
              비밀번호
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={4}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="block w-full rounded-xl border border-white/15 bg-white/10 px-4 py-4 text-sm text-white placeholder:text-white/35 focus:outline-none focus:ring-2 focus:ring-[#93C5FD]"
              placeholder="4자 이상"
            />
          </div>

          <div>
            <label htmlFor="confirm" className="mb-2 block text-xs font-semibold uppercase tracking-wide text-blue-200/70">
              비밀번호 확인
            </label>
            <input
              id="confirm"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="block w-full rounded-xl border border-white/15 bg-white/10 px-4 py-4 text-sm text-white placeholder:text-white/35 focus:outline-none focus:ring-2 focus:ring-[#93C5FD]"
              placeholder="비밀번호 재입력"
            />
          </div>

          {error && (
            <p className="rounded-xl border border-red-300/20 bg-red-500/20 px-3 py-2 text-sm text-red-200">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-[#3B82F6] px-4 py-4 text-sm font-bold text-white shadow-lg shadow-blue-950/30 transition hover:bg-[#2563EB] disabled:cursor-not-allowed disabled:bg-slate-600"
          >
            {loading ? "가입 중..." : "회원가입"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-white/60">
          이미 계정이 있으신가요?{" "}
          <Link href="/login" className="text-[#93C5FD] hover:underline">
            로그인
          </Link>
        </p>
      </div>
    </div>
  );
}
