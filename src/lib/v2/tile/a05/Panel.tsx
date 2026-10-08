"use client";

import { A05_TYPE_LABEL, A05_TYPES, normalizeA05Filter, type A05Filter, type A05Type } from "@/lib/v2/engine/a05-filter";
import type { TileDialogPanelProps } from "../component-types";
import styles from "./tile.module.css";

const A05_RANGE_FIELDS = [
  { key: "year", label: "준공연도", unit: "년" },
  { key: "households", label: "세대수", unit: "세대" },
  { key: "floors", label: "층수", unit: "층" },
] as const;
type A05RangeKey = (typeof A05_RANGE_FIELDS)[number]["key"];
type A05Bound = "min" | "max";

const safeA05Count = (value: number | null | undefined) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const a05CountText = (value: number | null | undefined) => safeA05Count(value).toLocaleString("ko-KR");

export type A05DialogPanelProps = TileDialogPanelProps;

export function A05FilterPanel({ filter, counts, onChange, titleId }: A05DialogPanelProps) {
  const selectedTypeSet = new Set(filter?.types ?? []);
  const hasPartialTypeFilter = selectedTypeSet.size > 0 && selectedTypeSet.size < A05_TYPES.length;
  const allTypesSelected = !hasPartialTypeFilter;

  const commit = (next: A05Filter) => onChange?.(normalizeA05Filter(next));
  const selectAllTypes = () => commit({ ...(filter ?? {}), types: undefined });
  const toggleType = (type: A05Type) => {
    const currentTypes = hasPartialTypeFilter ? A05_TYPES.filter((candidate) => selectedTypeSet.has(candidate)) : [];
    const nextTypes = hasPartialTypeFilter
      ? currentTypes.includes(type)
        ? currentTypes.filter((candidate) => candidate !== type)
        : [...currentTypes, type]
      : [type];
    commit({ ...(filter ?? {}), types: nextTypes.length === 0 || nextTypes.length === A05_TYPES.length ? undefined : nextTypes });
  };
  const rangeValue = (field: A05RangeKey, bound: A05Bound) => {
    const value = filter?.[field]?.[bound];
    return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
  };
  const updateRange = (field: A05RangeKey, bound: A05Bound, rawValue: string) => {
    const parsed = rawValue === "" ? null : Number(rawValue);
    const value = parsed === null || !Number.isFinite(parsed) ? null : parsed;
    const range = filter?.[field];
    commit({ ...(filter ?? {}), [field]: { min: range?.min ?? null, max: range?.max ?? null, [bound]: value } });
  };

  const total = safeA05Count(counts?.total);
  const kept = safeA05Count(counts?.kept);
  const unknownKept = safeA05Count(counts?.unknownKept);

  return (
    <section className={styles.a05Panel} aria-labelledby={titleId}>
      <div className={styles.a05PanelHeader}>
        <h3 id={titleId} className={styles.a05PanelTitle}>
          재집계
        </h3>
        <button type="button" className={styles.a05Reset} onClick={() => onChange?.(null)} aria-label="A05 필터 초기화">
          초기화
        </button>
      </div>

      <div className={styles.a05TypeBlock}>
        <span id={`${titleId}-types-label`} className={styles.a05SectionLabel}>
          주택 유형
        </span>
        <div className={styles.a05Types} role="group" aria-labelledby={`${titleId}-types-label`}>
          <button type="button" className={styles.a05Chip} aria-pressed={allTypesSelected} onClick={selectAllTypes}>
            전체
          </button>
          {A05_TYPES.map((type) => (
            <button type="button" key={type} className={styles.a05Chip} aria-pressed={hasPartialTypeFilter && selectedTypeSet.has(type)} onClick={() => toggleType(type)}>
              {A05_TYPE_LABEL[type]}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.a05Ranges}>
        {A05_RANGE_FIELDS.map(({ key, label, unit }) => {
          const minId = `${titleId}-${key}-min`;
          const maxId = `${titleId}-${key}-max`;
          const unknown = counts?.unknownByField[key];
          return (
            <fieldset key={key} className={styles.a05Range}>
              <legend className={styles.a05RangeLegend}>
                <span>{label}</span>
                <span className={styles.a05RangeUnknown}>정보 없음 {a05CountText(unknown)}건 포함</span>
              </legend>
              <div className={styles.a05RangeInputs}>
                <div className={styles.a05Bound}>
                  <label className={styles.a05BoundLabel} htmlFor={minId}>
                    최소
                  </label>
                  <input
                    id={minId}
                    className={styles.a05Input}
                    type="number"
                    inputMode="numeric"
                    step="1"
                    aria-label={`${label} 최소`}
                    value={rangeValue(key, "min")}
                    onChange={(event) => updateRange(key, "min", event.currentTarget.value)}
                  />
                  <span className={styles.a05Unit} aria-hidden="true">
                    {unit}
                  </span>
                </div>
                <div className={styles.a05Bound}>
                  <label className={styles.a05BoundLabel} htmlFor={maxId}>
                    최대
                  </label>
                  <input
                    id={maxId}
                    className={styles.a05Input}
                    type="number"
                    inputMode="numeric"
                    step="1"
                    aria-label={`${label} 최대`}
                    value={rangeValue(key, "max")}
                    onChange={(event) => updateRange(key, "max", event.currentTarget.value)}
                  />
                  <span className={styles.a05Unit} aria-hidden="true">
                    {unit}
                  </span>
                </div>
              </div>
            </fieldset>
          );
        })}
      </div>

      <p className={styles.a05Summary} aria-live="polite" aria-atomic="true">
        {a05CountText(total)}건 중 {a05CountText(kept)}건 · 정보 없음 {a05CountText(unknownKept)}건 포함
      </p>
    </section>
  );
}

export const a05DialogRegistration = {
  codes: ["A05"] as const,
  Component: A05FilterPanel,
};
