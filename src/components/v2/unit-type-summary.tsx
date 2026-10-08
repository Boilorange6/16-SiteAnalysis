import { unitTypeSummaryParts } from "@/lib/v2/unit-types";

type Props = { value: string; pairClassName?: string };

/** 타입·세대수 요약을 `59㎡ 1,964` 같은 짝 단위로만 끊는다. */
export default function UnitTypeSummary({ value, pairClassName }: Props) {
  const parts = unitTypeSummaryParts(value);
  return (
    <>
      {parts.map((part, index) => (
        <span key={`${part}-${index}`} className={pairClassName} style={{ display: "inline-block", whiteSpace: "nowrap" }}>
          {part}{index < parts.length - 1 ? " · " : ""}
        </span>
      ))}
    </>
  );
}
