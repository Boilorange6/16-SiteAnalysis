import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "사이트 분석 보고서 생성기",
  description: "부동산 사이트 분석 PPT 자동 생성",
};

export default function RootLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
