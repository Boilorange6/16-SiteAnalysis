"use client";

import {
  startTransition,
  useDeferredValue,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { searchAddresses, type AddressSearchResult } from "@/lib/data-provider";
import { getRegionSearchSuggestions } from "@/lib/region-search";
import type { RegionMetadata } from "@/lib/types";

interface AddressSearchProps {
  readonly regions: readonly RegionMetadata[];
  readonly selectedRegionCode: string;
  readonly loading: boolean;
  readonly inputClassName: string;
  readonly focusRingClassName: string;
  readonly onSelectRegion: (region: RegionMetadata) => void;
  readonly onSelectAddress: (result: AddressSearchResult) => void;
}

interface AddressSuggestionItem {
  readonly id: string;
  readonly kind: "region" | "address";
  readonly title: string;
  readonly subtitle: string;
  readonly matchedText: string;
  readonly region?: RegionMetadata;
  readonly result?: AddressSearchResult;
}

function compact(value: string): string {
  return value.replace(/\s+/g, "");
}

export default function AddressSearch({
  regions,
  selectedRegionCode,
  loading,
  inputClassName,
  focusRingClassName,
  onSelectRegion,
  onSelectAddress,
}: AddressSearchProps) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectionKind, setSelectionKind] = useState<"region" | "address" | null>(null);
  const [remoteSuggestions, setRemoteSuggestions] = useState<readonly AddressSearchResult[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const activeOptionId = activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined;
  const deferredQuery = useDeferredValue(query);
  const localSuggestions = getRegionSearchSuggestions(regions, deferredQuery);
  const selectedRegion = regions.find((region) => region.regionCode === selectedRegionCode) ?? null;
  const suggestionItems: readonly AddressSuggestionItem[] = [
    ...localSuggestions.map((suggestion) => ({
      id: `region-${suggestion.region.regionCode}`,
      kind: "region" as const,
      title: suggestion.title,
      subtitle: suggestion.subtitle,
      matchedText: suggestion.matchedText,
      region: suggestion.region,
    })),
    ...remoteSuggestions
      .filter(
        (result) =>
          !localSuggestions.some(
            (suggestion) =>
              compact(suggestion.subtitle) === compact(result.address) &&
              compact(suggestion.title) === compact(result.name)
          )
      )
      .map((result) => ({
        id: `address-${result.id}`,
        kind: "address" as const,
        title: result.name,
        subtitle: result.address,
        matchedText: "실시간 검색",
        result,
      })),
  ];
  const shouldShowResults =
    isOpen &&
    (suggestionItems.length > 0 || remoteLoading || deferredQuery.trim().length > 0 || regions.length > 0);

  useEffect(() => {
    if (!selectedRegion) {
      return;
    }

    setQuery(selectedRegion.address);
    setSelectionKind("region");
  }, [selectedRegion]);

  useEffect(() => {
    const trimmedQuery = deferredQuery.trim();
    if (trimmedQuery.length < 2) {
      setRemoteSuggestions([]);
      setRemoteLoading(false);
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      setRemoteLoading(true);
      searchAddresses(trimmedQuery)
        .then((results) => {
          if (!cancelled) {
            setRemoteSuggestions(results);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setRemoteSuggestions([]);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setRemoteLoading(false);
          }
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [deferredQuery]);

  useEffect(() => {
    if (!shouldShowResults) {
      setActiveIndex(0);
      return;
    }

    setActiveIndex((currentIndex) => {
      if (suggestionItems.length === 0) {
        return -1;
      }

      return Math.min(Math.max(currentIndex, 0), suggestionItems.length - 1);
    });
  }, [shouldShowResults, suggestionItems.length]);

  useEffect(() => {
    if (!shouldShowResults) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [shouldShowResults]);

  function handleSelectRegion(region: RegionMetadata) {
    setQuery(region.address);
    setIsOpen(false);
    setSelectionKind("region");
    startTransition(() => onSelectRegion(region));
  }

  function handleSelectAddress(result: AddressSearchResult) {
    setQuery(result.address);
    setIsOpen(false);
    setSelectionKind("address");
    startTransition(() => onSelectAddress(result));
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (!shouldShowResults && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      setIsOpen(true);
      return;
    }

    if (suggestionItems.length === 0) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((currentIndex) => (currentIndex + 1) % suggestionItems.length);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((currentIndex) => (currentIndex - 1 + suggestionItems.length) % suggestionItems.length);
      return;
    }

    if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      const activeItem = suggestionItems[activeIndex];

      if (activeItem.kind === "region" && activeItem.region) {
        handleSelectRegion(activeItem.region);
        return;
      }

      if (activeItem.kind === "address" && activeItem.result) {
        handleSelectAddress(activeItem.result);
      }
      return;
    }

    if (event.key === "Escape") {
      setIsOpen(false);
    }
  }

  return (
    <div ref={containerRef}>
      <label htmlFor={`${listboxId}-input`} className="text-[10px] font-bold uppercase tracking-[0.22em] text-blue-200/55">
        주소 검색
      </label>
      <div className="relative mt-1">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-white/45" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path
              d="M21 21L16.65 16.65M19 11C19 15.4183 15.4183 19 11 19C6.58172 19 3 15.4183 3 11C3 6.58172 6.58172 3 11 3C15.4183 3 19 6.58172 19 11Z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <input
          id={`${listboxId}-input`}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={shouldShowResults}
          aria-controls={listboxId}
          aria-activedescendant={shouldShowResults && activeOptionId ? activeOptionId : undefined}
          placeholder="예: 서울특별시 종로구 청와대로 1"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setIsOpen(true);
            setSelectionKind(null);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          aria-label="주소 자동완성 검색"
          data-testid="address-search-input"
          className={`pl-10 pr-10 ${inputClassName}`}
        />
        {(loading || remoteLoading) && (
          <div className="absolute inset-y-0 right-0 flex items-center pr-3 text-white/50" aria-hidden="true">
            <div className="h-4 w-4 rounded-full border-2 border-white/20 border-t-white/90 animate-spin" />
          </div>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-white/55">
        <p>
          {selectedRegion
            ? `${selectedRegion.regionName} POI 데이터를 사용 중`
            : selectionKind === "address"
              ? "선택한 주소 기준으로 실시간 POI를 불러오고 있습니다"
              : "검색 결과를 선택하면 해당 위치 기준으로 POI가 자동 로딩됩니다"}
        </p>
        {(selectedRegion || selectionKind === "address") && (
          <span
            className={`rounded-full border border-white/10 bg-white/10 px-2.5 py-1 text-[10px] font-semibold text-white/75 ${focusRingClassName}`}
            data-testid="active-region-badge"
          >
            {selectedRegion ? selectedRegion.defaultConfig.centerName : "실시간"}
          </span>
        )}
      </div>

      {shouldShowResults && (
        <div
          role="listbox"
          id={listboxId}
          className="mt-3 overflow-hidden rounded-2xl border border-white/10 bg-[#0F172A]/95 shadow-2xl shadow-[#020617]/40"
          data-testid="address-suggestion-list"
        >
          {suggestionItems.length > 0 ? (
            suggestionItems.map((suggestion, index) => {
              const isActive = index === activeIndex;
              const isSelected = suggestion.kind === "region" && suggestion.region?.regionCode === selectedRegionCode;

              return (
                <button
                  key={suggestion.id}
                  id={`${listboxId}-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onMouseDown={(event) => {
                    event.preventDefault();

                    if (suggestion.kind === "region" && suggestion.region) {
                      handleSelectRegion(suggestion.region);
                      return;
                    }

                    if (suggestion.kind === "address" && suggestion.result) {
                      handleSelectAddress(suggestion.result);
                    }
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={`flex w-full items-start justify-between gap-3 border-b border-white/6 px-4 py-3 text-left last:border-b-0 ${
                    isActive ? "bg-white/10" : "bg-transparent"
                  }`}
                  data-testid={`address-suggestion-${suggestion.id}`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{suggestion.title}</p>
                    <p className="mt-1 truncate text-xs text-blue-100/70">{suggestion.subtitle}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-white/8 px-2 py-1 text-[10px] font-semibold text-white/55">
                    {suggestion.matchedText}
                  </span>
                </button>
              );
            })
          ) : remoteLoading ? (
            <div className="px-4 py-4 text-sm text-white/60">주소 후보를 불러오는 중입니다...</div>
          ) : (
            <div className="px-4 py-4 text-sm text-white/60" data-testid="address-search-empty">
              일치하는 주소가 없습니다. `청와대`, `강남역`, `종로구`, `역삼동`으로 검색해보세요.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
