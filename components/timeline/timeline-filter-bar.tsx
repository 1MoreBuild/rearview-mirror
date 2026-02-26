"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type { TimelineCategory } from "@/lib/timeline-schema";
import type { Density, TimelineFilters } from "@/lib/timeline-utils";

type TimelineFilterBarProps = {
  filters: TimelineFilters;
  onChange: (filters: TimelineFilters) => void;
  availableOrgs: string[];
  availableYears: string[];
  totalCount: number;
  filteredCount: number;
};

type CategoryOption = "all" | TimelineCategory;

const CATEGORY_OPTIONS: { value: CategoryOption; label: string }[] = [
  { value: "all", label: "all" },
  { value: "model", label: "model" },
  { value: "product", label: "product" },
  { value: "engineering", label: "eng" },
];

export function TimelineFilterBar({
  filters,
  onChange,
  availableOrgs,
  availableYears,
  totalCount,
  filteredCount,
}: TimelineFilterBarProps) {
  const [localQuery, setLocalQuery] = useState(filters.query);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeCategory: CategoryOption =
    filters.categories.length === 1 ? filters.categories[0] : "all";

  // Sliding indicator refs
  const pillsRef = useRef<HTMLDivElement>(null);
  const pillRefs = useRef<Map<CategoryOption, HTMLButtonElement>>(new Map());
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  useLayoutEffect(() => {
    const container = pillsRef.current;
    const activeBtn = pillRefs.current.get(activeCategory);
    if (!container || !activeBtn) return;
    const containerRect = container.getBoundingClientRect();
    const btnRect = activeBtn.getBoundingClientRect();
    setIndicator({
      left: btnRect.left - containerRect.left,
      width: btnRect.width,
    });
  }, [activeCategory]);

  useEffect(() => {
    setLocalQuery(filters.query);
  }, [filters.query]);

  const handleQueryChange = useCallback(
    (value: string) => {
      setLocalQuery(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onChange({ ...filters, query: value });
      }, 200);
    },
    [filters, onChange],
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function selectCategory(cat: CategoryOption) {
    onChange({
      ...filters,
      categories: cat === "all" ? [] : [cat],
    });
  }

  function setDensity(density: Density) {
    onChange({ ...filters, density });
  }

  function setOrg(org: string) {
    onChange({
      ...filters,
      organizations: org === "all" ? [] : [org],
    });
  }

  function setYear(year: string) {
    onChange({ ...filters, year });
  }

  const isFiltered =
    filters.query !== "" ||
    filters.year !== "all" ||
    filters.density !== "all" ||
    filters.categories.length > 0 ||
    filters.organizations.length > 0;

  return (
    <div className="filter-bar">
      <div className="filter-bar-inner">
        <div className="filter-row">
          <div
            className="filter-pills"
            role="radiogroup"
            aria-label="Category"
            ref={pillsRef}
          >
            <span
              className="filter-pill-indicator"
              style={{
                transform: `translateX(${indicator.left}px)`,
                width: indicator.width,
              }}
            />
            {CATEGORY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                ref={(el) => {
                  if (el) pillRefs.current.set(opt.value, el);
                }}
                type="button"
                role="radio"
                className={`filter-pill${activeCategory === opt.value ? " is-active" : ""}`}
                onClick={() => selectCategory(opt.value)}
                aria-checked={activeCategory === opt.value}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="filter-toggle" role="group" aria-label="Density">
            <button
              type="button"
              className={`filter-pill${filters.density === "all" ? " is-active" : ""}`}
              onClick={() => setDensity("all")}
              aria-pressed={filters.density === "all"}
            >
              all
            </button>
            <button
              type="button"
              className={`filter-pill${filters.density === "highlights" ? " is-active" : ""}`}
              onClick={() => setDensity("highlights")}
              aria-pressed={filters.density === "highlights"}
            >
              key
            </button>
          </div>
        </div>

        <div className="filter-row">
          <input
            type="search"
            className="filter-input"
            placeholder="search..."
            value={localQuery}
            onChange={(e) => handleQueryChange(e.target.value)}
            aria-label="Search events"
          />

          <select
            className="filter-select"
            value={filters.organizations[0] ?? "all"}
            onChange={(e) => setOrg(e.target.value)}
            aria-label="Filter by organization"
          >
            <option value="all">all orgs</option>
            {availableOrgs.map((org) => (
              <option key={org} value={org}>
                {org.toLowerCase()}
              </option>
            ))}
          </select>

          <select
            className="filter-select"
            value={filters.year}
            onChange={(e) => setYear(e.target.value)}
            aria-label="Filter by year"
          >
            <option value="all">all years</option>
            {availableYears.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>

          <span className="filter-count" aria-live="polite">
            {isFiltered
              ? `${filteredCount} of ${totalCount}`
              : `${totalCount} events`}
          </span>
        </div>
      </div>
    </div>
  );
}
