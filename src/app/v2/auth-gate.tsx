"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/providers/auth-provider";

/** 로그인하지 않은 사용자는 v2 화면을 볼 수 없다. 로그인 뒤 원래 v2 주소로 돌아온다. */
export default function V2AuthGate({ children }: { readonly children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) {
      const next = window.location.pathname.replace(/^\/site/, "") + window.location.search;
      router.replace(`/login?next=${encodeURIComponent(next)}`);
    }
  }, [isLoading, user, router]);

  if (!user) return null;
  return <>{children}</>;
}
