"use client";

import { useAuth } from "@/providers/auth-provider";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import SiteAnalysisApp from "@/components/site-analysis-app";

export default function Page() {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/login");
    }
  }, [isLoading, user, router]);

  if (isLoading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-[#0F172A]">
        <div className="rounded-2xl border border-white/10 bg-[#1E3A8A] p-10 text-center shadow-2xl">
          <div className="mx-auto mb-6 h-12 w-12 animate-spin rounded-full border-4 border-blue-400 border-t-white" />
          <p className="text-lg font-bold text-white">로딩 중</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return <SiteAnalysisApp />;
}
