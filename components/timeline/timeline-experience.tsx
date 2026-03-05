"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { TimelineCategory } from "@/lib/timeline-schema";
import type { TimelineEvent } from "@/lib/timeline-schema";
import type { Density, TimelineFilters } from "@/lib/timeline-utils";
import {
  filterEvents,
  getAvailableOrganizations,
  getAvailableYears,
  sortEventsNewestFirst,
} from "@/lib/timeline-utils";
import { groupByMonth, TimelineList } from "@/components/timeline/timeline-list";
import { TimelineMinimap } from "@/components/timeline/timeline-minimap";
import { TimelineFilterBar } from "@/components/timeline/timeline-filter-bar";

type TimelineExperienceProps = {
  events: TimelineEvent[];
  svgContents: Record<string, string>;
  rasterFallbacks: Record<string, string>;
  initialParams?: TimelineInitialParams;
};

type TimelineInitialParams = {
  category?: string;
  density?: string;
  q?: string;
  year?: string;
  org?: string;
};

const VALID_CATEGORIES = new Set(["model", "product", "engineering", "pelican"]);
const VALID_DENSITIES = new Set(["all", "highlights"]);

function getParamValue(
  params: URLSearchParams | TimelineInitialParams | undefined,
  key: keyof TimelineInitialParams,
): string | null {
  if (!params) return null;
  if (params instanceof URLSearchParams) {
    return params.get(key);
  }

  return params[key] ?? null;
}

function filtersFromParams(params: URLSearchParams | TimelineInitialParams | undefined): TimelineFilters {
  const cat = getParamValue(params, "category");
  const density = getParamValue(params, "density");
  const org = getParamValue(params, "org");
  return {
    query: getParamValue(params, "q") ?? "",
    year: getParamValue(params, "year") ?? "all",
    density: density && VALID_DENSITIES.has(density) ? (density as Density) : "all",
    categories: cat && VALID_CATEGORIES.has(cat) ? [cat as TimelineCategory] : [],
    organizations: org ? [org] : [],
  };
}

function areFiltersEqual(left: TimelineFilters, right: TimelineFilters): boolean {
  return (
    left.query === right.query &&
    left.year === right.year &&
    left.density === right.density &&
    left.categories.length === right.categories.length &&
    left.categories[0] === right.categories[0] &&
    left.organizations.length === right.organizations.length &&
    left.organizations[0] === right.organizations[0]
  );
}

function filtersToParams(filters: TimelineFilters): string {
  const params = new URLSearchParams();
  if (filters.categories.length === 1) params.set("category", filters.categories[0]);
  if (filters.query) params.set("q", filters.query);
  if (filters.year !== "all") params.set("year", filters.year);
  if (filters.density !== "all") params.set("density", filters.density);
  if (filters.organizations.length === 1) params.set("org", filters.organizations[0]);
  const str = params.toString();
  return str ? `?${str}` : "/";
}

export function TimelineExperience({
  events,
  svgContents,
  rasterFallbacks,
  initialParams,
}: TimelineExperienceProps) {
  const [filters, setFilters] = useState<TimelineFilters>(() => filtersFromParams(initialParams));
  const isInitial = useRef(true);
  const handleFilterBarHeightChange = useCallback((height: number) => {
    document.documentElement.style.setProperty("--filter-bar-h", `${height}px`);
    try {
      localStorage.setItem("rearview-filter-h", String(height));
    } catch {}
  }, []);

  // Sync URL → state on popstate (browser back/forward)
  useEffect(() => {
    const syncFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      const nextFilters = filtersFromParams(params);
      setFilters((current) => (areFiltersEqual(current, nextFilters) ? current : nextFilters));
    };

    window.addEventListener("popstate", syncFromUrl);
    return () => {
      window.removeEventListener("popstate", syncFromUrl);
    };
  }, []);

  // Sync state → URL and scroll to top on filter change
  const handleFilterChange = useCallback((next: TimelineFilters) => {
    setFilters(next);
    window.history.replaceState(null, "", filtersToParams(next));
    window.scrollTo({ top: 0 });
  }, []);

  // Don't scroll on initial load
  useEffect(() => {
    isInitial.current = false;
  }, []);

  useEffect(() => {
    return () => {
      document.documentElement.style.removeProperty("--filter-bar-h");
    };
  }, []);

  const availableOrgs = getAvailableOrganizations(events);
  const availableYears = getAvailableYears(events);

  const filtered = filterEvents(events, filters);
  const sorted = sortEventsNewestFirst(filtered);

  return (
    <>
      <div className="sticky-backdrop" aria-hidden="true" />
      <TimelineFilterBar
        filters={filters}
        onChange={handleFilterChange}
        availableOrgs={availableOrgs}
        availableYears={availableYears}
        totalCount={events.length}
        filteredCount={filtered.length}
        onHeightChange={handleFilterBarHeightChange}
      />
      <main className="site-content">
        <TimelineList groups={groupByMonth(sorted)} svgContents={svgContents} rasterFallbacks={rasterFallbacks} />
        <TimelineMinimap groups={groupByMonth(sorted)} />
      </main>
    </>
  );
}
