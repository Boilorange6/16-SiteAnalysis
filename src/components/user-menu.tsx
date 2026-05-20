"use client";

import Link from "next/link";
import { useAuth } from "@/providers/auth-provider";

export default function UserMenu() {
  const { user, logout } = useAuth();

  if (!user) return null;

  return (
    <div className="rounded-2xl border border-white/8 bg-black/15 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-blue-200/55">
            계정
          </p>
          <p className="mt-1 text-sm font-semibold text-white">{user.username}</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/mypage"
            className="rounded-full border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/80 transition hover:bg-white/10 hover:text-white"
          >
            API 키
          </Link>
          <button
            type="button"
            onClick={logout}
            className="rounded-full border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/80 transition hover:bg-white/10 hover:text-white"
          >
            로그아웃
          </button>
        </div>
      </div>
    </div>
  );
}
