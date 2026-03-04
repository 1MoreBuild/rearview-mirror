"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

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
};

const VALID_CATEGORIES = new Set(["model", "product", "engineering", "pelican"]);
const VALID_DENSITIES = new Set(["all", "highlights"]);

function filtersFromParams(params: URLSearchParams): TimelineFilters {
  const cat = params.get("category");
  const density = params.get("density");
  return {
    query: params.get("q") ?? "",
    year: params.get("year") ?? "all",
    density: density && VALID_DENSITIES.has(density) ? (density as Density) : "all",
    categories: cat && VALID_CATEGORIES.has(cat) ? [cat as TimelineCategory] : [],
    organizations: params.get("org") ? [params.get("org")!] : [],
  };
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

export function TimelineExperience({ events, svgContents, rasterFallbacks }: TimelineExperienceProps) {
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState<TimelineFilters>(() => filtersFromParams(searchParams));
  const isInitial = useRef(true);

  // Sync URL → state on popstate (browser back/forward)
  useEffect(() => {
    setFilters(filtersFromParams(searchParams));
  }, [searchParams]);

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
      />
      <main className="site-content">
        <TimelineList groups={groupByMonth(sorted)} svgContents={svgContents} rasterFallbacks={rasterFallbacks} />
        <TimelineMinimap groups={groupByMonth(sorted)} />
      </main>
    </>
  );
}
