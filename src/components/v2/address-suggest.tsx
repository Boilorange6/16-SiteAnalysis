"use client";

import { useEffect, useId, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { addressSuggestionText, addressValueForSelection, isSelectableSuggestion } from "@/lib/address-search";
import { searchAddresses, type AddressSearchResult } from "@/lib/data-provider";
import styles from "./board.module.css";

type AddressSuggestProps = {
  readonly id?: string;
  readonly value: string;
  readonly disabled?: boolean;
  readonly inputClassName: string;
  readonly ariaInvalid?: boolean;
  readonly ariaDescribedBy?: string;
  readonly onChange: (value: string) => void;
};

export default function AddressSuggest({
  id,
  value,
  disabled = false,
  inputClassName,
  ariaInvalid = false,
  ariaDescribedBy,
  onChange,
}: AddressSuggestProps) {
  const listboxId = useId();
  const inputId = id ?? `${listboxId}-input`;
  const [results, setResults] = useState<readonly AddressSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const trimmedValue = value.trim();
  const activeOptionId = activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined;
  const shouldShowResults = !disabled && isOpen && (results.length > 0 || isLoading || trimmedValue.length >= 2 || !!errorMessage);

  useEffect(() => {
    if (disabled || trimmedValue.length < 2) {
      setResults([]);
      setIsLoading(false);
      setActiveIndex(-1);
      setErrorMessage(null);
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      setIsLoading(true);
      setErrorMessage(null);
      searchAddresses(trimmedValue, 1, 5)
        .then((nextResults) => {
          if (!cancelled) {
            setResults(nextResults.filter(isSelectableSuggestion).slice(0, 5));
            setErrorMessage(null);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setResults([]);
            setErrorMessage("주소 후보를 불러오지 못했습니다.");
          }
        })
        .finally(() => {
          if (!cancelled) setIsLoading(false);
        });
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [disabled, trimmedValue]);

  useEffect(() => {
    if (!shouldShowResults) {
      setActiveIndex(-1);
      return;
    }

    // 자동 선택하지 않는다: 지번을 직접 치고 Enter를 누르면 후보가 아니라 분석이 실행돼야 한다.
    setActiveIndex((currentIndex) => (results.length === 0 ? -1 : Math.min(currentIndex, results.length - 1)));
  }, [results.length, shouldShowResults]);

  function handleSelect(result: AddressSearchResult): void {
    setIsOpen(false);
    setResults([]);
    setActiveIndex(-1);
    setErrorMessage(null);
    onChange(addressValueForSelection(result));
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Escape") {
      setIsOpen(false);
      setActiveIndex(-1);
      return;
    }

    if (!shouldShowResults || results.length === 0) {
      if (event.key === "ArrowDown" && trimmedValue.length >= 2) setIsOpen(true);
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

    if (event.key === "Enter") {
      if (activeIndex >= 0) {
        event.preventDefault();
        handleSelect(results[activeIndex]);
      } else {
        setIsOpen(false);
      }
    }
  }

  return (
    <div
      className={styles.addressSuggest}
      onBlur={(event) => {
        // Delay blur so pointerdown on an option can select it on touch devices.
        const container = event.currentTarget;
        const related = event.relatedTarget as Node | null;
        if (!container.contains(related)) {
          window.setTimeout(() => {
            if (!container.contains(document.activeElement)) {
              setIsOpen(false);
              setActiveIndex(-1);
            }
          }, 100);
        }
      }}
    >
      <input
        id={inputId}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={shouldShowResults}
        aria-controls={listboxId}
        aria-activedescendant={shouldShowResults && activeOptionId ? activeOptionId : undefined}
        aria-label="지번 주소"
        aria-invalid={ariaInvalid || undefined}
        aria-describedby={ariaDescribedBy}
        autoComplete="off"
        spellCheck={false}
        placeholder="지번 주소 (예: 서울 강동구 고덕동 123)"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setIsOpen(true);
          if (errorMessage) setErrorMessage(null);
        }}
        onFocus={() => {
          if (!disabled) setIsOpen(true);
        }}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        className={`${inputClassName} ${styles.addressSuggestInput}`}
        data-testid="v2-address-input"
      />

      {shouldShowResults && (
        <div id={listboxId} role="listbox" className={styles.addressSuggestList} data-testid="v2-address-suggestions">
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
                  onPointerDown={(event) => {
                    event.preventDefault();
                    handleSelect(result);
                  }}
                  onPointerEnter={() => setActiveIndex(index)}
                  className={`${styles.addressSuggestOption} ${isActive ? styles.addressSuggestOptionActive : ""}`}
                  data-testid={`v2-address-suggestion-${index}`}
                >
                  <span className={styles.addressSuggestName}>{result.name}</span>
                  <span className={styles.addressSuggestDetail}>{addressSuggestionText(result)}</span>
                </button>
              );
            })
          ) : isLoading ? (
            <div className={styles.addressSuggestStatus}>주소 후보를 불러오는 중입니다…</div>
          ) : errorMessage ? (
            <div className={styles.addressSuggestStatus} role="status" data-testid="v2-address-suggestion-error">{errorMessage}</div>
          ) : (
            <div className={styles.addressSuggestStatus} data-testid="v2-address-suggestion-empty">일치하는 주소가 없습니다.</div>
          )}
        </div>
      )}
    </div>
  );
}
