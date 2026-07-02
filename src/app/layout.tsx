import type { Metadata, Viewport } from "next";
import { Noto_Sans_KR } from "next/font/google";
import "./globals.css";

const notoSansKr = Noto_Sans_KR({
  subsets: ["latin"],
  weight: ["400", "700", "900"],
  display: "swap",
  variable: "--font-noto",
});

export const metadata: Metadata = {
  title: "사이트 분석 보고서 생성기",
  description: "부동산 사이트 분석 PPT 자동 생성",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <head>
        <meta charSet="utf-8" />
      </head>
      <body className={`${notoSansKr.variable} ${notoSansKr.className} antialiased`} suppressHydrationWarning>{children}</body>
    </html>
  );
}
