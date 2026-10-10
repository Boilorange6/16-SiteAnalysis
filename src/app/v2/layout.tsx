import { Do_Hyeon } from "next/font/google";

const doHyeon = Do_Hyeon({ subsets: ["latin"], weight: "400", variable: "--font-dohyeon", display: "swap" });

export default function V2Layout({ children }: { readonly children: React.ReactNode }) {
  return <div className={doHyeon.variable}>{children}</div>;
}
