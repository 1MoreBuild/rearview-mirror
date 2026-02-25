"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { ModelTimelineEvent } from "@/lib/timeline-schema";
import {
  filterEvents,
  getAvailableYears,
  type ImpactFilter,
  sortEventsNewestFirst,
} from "@/lib/timeline-utils";
import { FilterBar } from "@/components/timeline/filter-bar";
import { TimelineList } from "@/components/timeline/timeline-list";

type TimelineExperienceProps = {
  events: ModelTimelineEvent[];
};

function readImpactFilter(value: string | null): ImpactFilter {
  if (value === "high" || value === "medium" || value === "low") {
    return value;
  }

  return "all";
}

export function TimelineExperience({ events }: TimelineExperienceProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const sortedEvents = useMemo(() => sortEventsNewestFirst(events), [events]);
  const years = useMemo(() => getAvailableYears(events), [events]);

  const query = searchParams.get("q") ?? "";
  const year = searchParams.get("year") ?? "all";
  const impact = readImpactFilter(searchParams.get("impact"));

  const [searchDraft, setSearchDraft] = useState(query);

  useEffect(() => {
    setSearchDraft(query);
  }, [query]);

  const setParam = useCallback(
    (key: "q" | "year" | "impact", value: string) => {
      const nextParams = new URLSearchParams(searchParams.toString());

      if (!value || value === "all") {
        nextParams.delete(key);
      } else {
        nextParams.set(key, value);
      }

      const nextQuery = nextParams.toString();
      const nextPath = nextQuery ? `${pathname}?${nextQuery}` : pathname;

      router.replace(nextPath, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (searchDraft !== query) {
        setParam("q", searchDraft.trim());
      }
    }, 180);

    return () => window.clearTimeout(timer);
  }, [query, searchDraft, setParam]);

  const filteredEvents = useMemo(
    () =>
      filterEvents(sortedEvents, {
        query,
        year,
        impact,
      }),
    [impact, query, sortedEvents, year],
  );

  return (
    <>
      <FilterBar
        search={searchDraft}
        year={year}
        impact={impact}
        years={years}
        resultCount={filteredEvents.length}
        totalCount={events.length}
        onSearchChange={setSearchDraft}
        onYearChange={(value) => setParam("year", value)}
        onImpactChange={(value) => setParam("impact", value)}
      />
      <TimelineList events={filteredEvents} />
    </>
  );
}
