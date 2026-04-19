"use client";

import { useEffect, useId, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { searchAddresses, type AddressSearchResult } from "@/lib/data-provider";

interface AddressSearchInputProps {
  readonly id?: string;
  readonly value: string;
  readonly loading?: boolean;
  readonly inputClassName: string;
  readonly onChange: (value: string) => void;
  readonly onSelect: (result: AddressSearchResult) => void;
}

export default function AddressSearchInput({
  id,
  value,
  loading = false,
  inputClassName,
  onChange,
  onSelect,
}: AddressSearchInputProps) {
  const listboxId = useId();
  const inputId = id ?? `${listboxId}-input`;
  const [results, setResults] = useState<readonly AddressSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const trimmedValue = value.trim();
  const activeOptionId = activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined;
  const shouldShowResults = isOpen && (results.length > 0 || isLoading || trimmedValue.length >= 2);

  useEffect(() => {
    if (trimmedValue.length < 2) {
      setResults([]);
      setIsLoading(false);
      setActiveIndex(-1);
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      setIsLoading(true);
      searchAddresses(trimmedValue, 1, 5)
        .then((nextResults) => {
          if (!cancelled) {
            setResults(nextResults.slice(0, 5));
          }
        })
        .catch(() => {
          if (!cancelled) {
            setResults([]);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setIsLoading(false);
          }
        });
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [trimmedValue]);

  useEffect(() => {
    if (!shouldShowResults) {
      setActiveIndex(-1);
      return;
    }

    setActiveIndex((currentIndex) => {
      if (results.length === 0) {
        return -1;
      }

      if (currentIndex < 0) {
        return 0;
      }

      return Math.min(currentIndex, results.length - 1);
    });
  }, [results.length, shouldShowResults]);

  function handleSelect(result: AddressSearchResult) {
    setIsOpen(false);
    setResults([]);
    setActiveIndex(-1);
    onSelect(result);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setIsOpen(false);
      setActiveIndex(-1);
      return;
    }

    if (!shouldShowResults || results.length === 0) {
      if (event.key === "ArrowDown" && trimmedValue.length >= 2) {
        setIsOpen(true);
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((currentIndex) => (currentIndex + 1) % results.length);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((currentIndex) => (currentIndex - 1 + results.length) % results.length);
      return;
    }

    if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      handleSelect(results[activeIndex]);
    }
  }

  return (
    <div
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsOpen(false);
          setActiveIndex(-1);
        }
      }}
    >
      <div className="relative">
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
          id={inputId}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={shouldShowResults}
          aria-controls={listboxId}
          aria-activedescendant={shouldShowResults && activeOptionId ? activeOptionId : undefined}
          placeholder="예: 서울시 종로구 세종로 1"
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          aria-label="분석 중심 주소 검색"
          data-testid="center-name-input"
          className={`pl-10 pr-10 ${inputClassName}`}
        />

        {(loading || isLoading) && (
          <div className="absolute inset-y-0 right-0 flex items-center pr-3 text-white/50" aria-hidden="true">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white/90" />
          </div>
        )}
      </div>

      {shouldShowResults && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+0.75rem)] z-20 overflow-hidden rounded-2xl border border-white/10 bg-[#0F172A]/95 shadow-2xl shadow-[#020617]/40"
          data-testid="address-search-autocomplete"
        >
          {results.length > 0 ? (
            results.map((result, index) => {
              const isActive = index === activeIndex;

              return (
                <button
                  key={result.id}
                  id={`${listboxId}-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    handleSelect(result);
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={`flex w-full items-start justify-between gap-3 border-b border-white/6 px-4 py-3 text-left last:border-b-0 ${
                    isActive ? "bg-white/10" : "bg-transparent"
                  }`}
                  data-testid={`address-search-option-${index}`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{result.name}</p>
                    <p className="mt-1 truncate text-xs text-blue-100/70">{result.address}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-white/8 px-2 py-1 text-[10px] font-semibold text-white/55">
                    좌표 적용
                  </span>
                </button>
              );
            })
          ) : isLoading ? (
            <div className="px-4 py-4 text-sm text-white/60">주소 후보를 불러오는 중입니다...</div>
          ) : (
            <div className="px-4 py-4 text-sm text-white/60" data-testid="address-search-empty">
              일치하는 주소가 없습니다. `청와대`, `강남역`, `종로구`로 다시 검색해보세요.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
