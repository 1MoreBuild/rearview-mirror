"use client";

import { useState } from "react";

import type { TimelineEvent } from "@/lib/timeline-schema";
import type { TimelineFilters } from "@/lib/timeline-utils";
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
};

const DEFAULT_FILTERS: TimelineFilters = {
  query: "",
  year: "all",
  density: "all",
  categories: [],
  organizations: [],
};

export function TimelineExperience({ events }: TimelineExperienceProps) {
  const [filters, setFilters] = useState<TimelineFilters>(DEFAULT_FILTERS);

  const availableOrgs = getAvailableOrganizations(events);
  const availableYears = getAvailableYears(events);

  const filtered = filterEvents(events, filters);
  const sorted = sortEventsNewestFirst(filtered);
  const groups = groupByMonth(sorted);

  return (
    <>
      <div className="sticky-backdrop" aria-hidden="true" />
      <TimelineFilterBar
        filters={filters}
        onChange={setFilters}
        availableOrgs={availableOrgs}
        availableYears={availableYears}
        totalCount={events.length}
        filteredCount={filtered.length}
      />
      <main className="site-content">
        <TimelineList groups={groups} />
        <TimelineMinimap groups={groups} />
      </main>
    </>
  );
}
