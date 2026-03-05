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
  onHeightChange?: (height: number) => void;
};

type CategoryOption = "all" | TimelineCategory;
type DensityOption = Density;

const CATEGORY_OPTIONS: { value: CategoryOption; label: string }[] = [
  { value: "all", label: "all" },
  { value: "model", label: "model" },
  { value: "product", label: "product" },
  { value: "engineering", label: "eng" },
  { value: "pelican", label: "pelican" },
];

const DENSITY_OPTIONS: { value: DensityOption; label: string }[] = [
  { value: "all", label: "all" },
  { value: "highlights", label: "key" },
];

export function TimelineFilterBar({
  filters,
  onChange,
  availableOrgs,
  availableYears,
  totalCount,
  filteredCount,
  onHeightChange,
}: TimelineFilterBarProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const queryInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestFiltersRef = useRef(filters);

  const activeCategory: CategoryOption =
    filters.categories.length === 1 ? filters.categories[0] : "all";

  // Sliding indicator refs
  const pillsRef = useRef<HTMLDivElement>(null);
  const pillRefs = useRef<Map<CategoryOption, HTMLButtonElement>>(new Map());
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });
  const [isCategoryIndicatorReady, setIsCategoryIndicatorReady] = useState(false);
  const [isCategoryIndicatorAnimated, setIsCategoryIndicatorAnimated] = useState(false);
  const densityRef = useRef<HTMLDivElement>(null);
  const densityButtonRefs = useRef<Map<DensityOption, HTMLButtonElement>>(new Map());
  const [densityIndicator, setDensityIndicator] = useState({ left: 0, width: 0 });
  const [isDensityIndicatorReady, setIsDensityIndicatorReady] = useState(false);
  const [isDensityIndicatorAnimated, setIsDensityIndicatorAnimated] = useState(false);

  const syncCategoryIndicator = useCallback(() => {
    const container = pillsRef.current;
    const activeBtn = pillRefs.current.get(activeCategory);
    if (!container || !activeBtn) return;
    const containerRect = container.getBoundingClientRect();
    const btnRect = activeBtn.getBoundingClientRect();
    setIndicator({
      left: btnRect.left - containerRect.left,
      width: btnRect.width,
    });
    setIsCategoryIndicatorReady(true);
  }, [activeCategory]);

  const syncDensityIndicator = useCallback(() => {
    const container = densityRef.current;
    const activeBtn = densityButtonRefs.current.get(filters.density);
    if (!container || !activeBtn) return;
    const containerRect = container.getBoundingClientRect();
    const btnRect = activeBtn.getBoundingClientRect();
    setDensityIndicator({
      left: btnRect.left - containerRect.left,
      width: btnRect.width,
    });
    setIsDensityIndicatorReady(true);
  }, [filters.density]);

  useLayoutEffect(() => {
    syncCategoryIndicator();
  }, [syncCategoryIndicator]);

  useLayoutEffect(() => {
    syncDensityIndicator();
  }, [syncDensityIndicator]);

  useEffect(() => {
    latestFiltersRef.current = filters;
  }, [filters]);

  useEffect(() => {
    if (!queryInputRef.current) return;
    if (queryInputRef.current.value === filters.query) return;
    queryInputRef.current.value = filters.query;
  }, [filters.query]);

  const handleQueryChange = useCallback(
    (value: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onChange({ ...latestFiltersRef.current, query: value });
      }, 200);
    },
    [onChange],
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  useLayoutEffect(() => {
    if (!onHeightChange) return;
    const element = rootRef.current;
    if (!element) return;

    const notify = () => onHeightChange(Math.ceil(element.getBoundingClientRect().height));
    notify();
    const rafId = requestAnimationFrame(notify);

    const observer = new ResizeObserver(() => notify());
    observer.observe(element);
    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [onHeightChange]);

  useEffect(() => {
    const container = pillsRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => syncCategoryIndicator());
    observer.observe(container);
    return () => observer.disconnect();
  }, [syncCategoryIndicator]);

  useEffect(() => {
    const container = densityRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => syncDensityIndicator());
    observer.observe(container);
    return () => observer.disconnect();
  }, [syncDensityIndicator]);

  useEffect(() => {
    const syncIndicators = () => {
      syncCategoryIndicator();
      syncDensityIndicator();
    };

    window.addEventListener("resize", syncIndicators);

    let canceled = false;
    const fonts = document.fonts;
    if (fonts) {
      fonts.ready.then(() => {
        if (!canceled) {
          syncIndicators();
        }
      });
    }

    return () => {
      canceled = true;
      window.removeEventListener("resize", syncIndicators);
    };
  }, [syncCategoryIndicator, syncDensityIndicator]);

  function selectCategory(cat: CategoryOption) {
    setIsCategoryIndicatorAnimated(true);
    onChange({
      ...filters,
      categories: cat === "all" ? [] : [cat],
    });
  }

  function setDensity(density: Density) {
    setIsDensityIndicatorAnimated(true);
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
    <div className="filter-bar" ref={rootRef}>
      <div className="filter-bar-inner">
        <div className="filter-top-row">
          <div className="filter-mode-group">
            <div
              className={`filter-pills${isCategoryIndicatorReady ? " is-indicator-ready" : ""}`}
              role="radiogroup"
              aria-label="Category"
              ref={pillsRef}
            >
              <span
                className={`filter-pill-indicator${isCategoryIndicatorReady ? " is-ready" : ""}${isCategoryIndicatorAnimated ? " is-animated" : ""}`}
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

            <div
              className={`filter-toggle${isDensityIndicatorReady ? " is-indicator-ready" : ""}`}
              role="radiogroup"
              aria-label="Density"
              ref={densityRef}
            >
              <span
                className={`filter-pill-indicator${isDensityIndicatorReady ? " is-ready" : ""}${isDensityIndicatorAnimated ? " is-animated" : ""}`}
                style={{
                  transform: `translateX(${densityIndicator.left}px)`,
                  width: densityIndicator.width,
                }}
              />
              {DENSITY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  ref={(el) => {
                    if (el) densityButtonRefs.current.set(opt.value, el);
                  }}
                  type="button"
                  role="radio"
                  className={`filter-pill${filters.density === opt.value ? " is-active" : ""}`}
                  onClick={() => setDensity(opt.value)}
                  aria-checked={filters.density === opt.value}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <span className="filter-count" aria-live="polite">
            {isFiltered
              ? `${filteredCount} of ${totalCount}`
              : `${totalCount} events`}
          </span>
        </div>

        <div className="filter-bottom-row">
          <input
            ref={queryInputRef}
            type="search"
            className="filter-input"
            placeholder="search..."
            defaultValue={filters.query}
            onChange={(e) => handleQueryChange(e.target.value)}
            aria-label="Search events"
          />

          <div className="filter-selects">
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
          </div>
        </div>
      </div>
    </div>
  );
}
