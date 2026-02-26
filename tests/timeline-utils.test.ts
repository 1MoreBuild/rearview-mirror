import { describe, expect, it } from "vitest";

import { getTimelineEvents } from "@/lib/timeline";
import {
  filterEvents,
  formatEventDate,
  formatEventDateShort,
  getAvailableOrganizations,
  getAvailableYears,
  sortEventsNewestFirst,
} from "@/lib/timeline-utils";

const events = getTimelineEvents();

function toComparableValue(date: string, precision: "day" | "month" | "year"): number {
  const [yearPart, monthPart, dayPart] = date.split("-").map(Number);

  const year = Number.isFinite(yearPart) ? yearPart : 0;
  const month = Number.isFinite(monthPart)
    ? monthPart
    : precision === "year"
      ? 12
      : 1;
  const day = Number.isFinite(dayPart)
    ? dayPart
    : precision === "day"
      ? 1
      : 31;

  return Date.UTC(year, month - 1, day);
}

describe("timeline utils", () => {
  it("loads all normalized events", () => {
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it("sorts newest first", () => {
    const sorted = sortEventsNewestFirst(events);

    for (let index = 1; index < sorted.length; index += 1) {
      const prev = sorted[index - 1];
      const curr = sorted[index];

      const prevValue = toComparableValue(prev.date, prev.datePrecision);
      const currValue = toComparableValue(curr.date, curr.datePrecision);

      expect(prevValue).toBeGreaterThanOrEqual(currValue);
    }
  });

  it("filters by year", () => {
    const sorted = sortEventsNewestFirst(events);
    const years = getAvailableYears(sorted);
    const targetYear = years[0];

    const filtered = filterEvents(sorted, {
      query: "",
      year: targetYear,
      density: "all",
      categories: [],
      organizations: [],
    });

    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((event) => event.date.startsWith(targetYear))).toBe(true);
  });

  it("filters by density (highlights only)", () => {
    const sorted = sortEventsNewestFirst(events);
    const filtered = filterEvents(sorted, {
      query: "",
      year: "all",
      density: "highlights",
      categories: [],
      organizations: [],
    });

    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((event) => event.significance === "high")).toBe(true);
  });

  it("filters by category", () => {
    const sorted = sortEventsNewestFirst(events);
    const filtered = filterEvents(sorted, {
      query: "",
      year: "all",
      density: "all",
      categories: ["model"],
      organizations: [],
    });

    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((event) => event.category === "model")).toBe(true);
  });

  it("filters by organization", () => {
    const sorted = sortEventsNewestFirst(events);
    const orgs = getAvailableOrganizations(sorted);
    const targetOrg = orgs[0];

    const filtered = filterEvents(sorted, {
      query: "",
      year: "all",
      density: "all",
      categories: [],
      organizations: [targetOrg],
    });

    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((event) => event.organization === targetOrg)).toBe(true);
  });

  it("searches across title, organization, and tags", () => {
    const sorted = sortEventsNewestFirst(events);
    const searchTerm = sorted[0].organization.toLowerCase().split(/\s+/)[0];

    const filtered = filterEvents(sorted, {
      query: searchTerm,
      year: "all",
      density: "all",
      categories: [],
      organizations: [],
    });

    expect(filtered.length).toBeGreaterThan(0);
    expect(
      filtered.every(
        (event) =>
          event.title.toLowerCase().includes(searchTerm) ||
          event.summary.toLowerCase().includes(searchTerm) ||
          event.organization.toLowerCase().includes(searchTerm) ||
          event.tags.join(" ").toLowerCase().includes(searchTerm),
      ),
    ).toBe(true);
  });

  it("returns years in descending order", () => {
    const years = getAvailableYears(events);

    expect(years.length).toBeGreaterThan(0);
    for (let i = 1; i < years.length; i++) {
      expect(Number(years[i - 1])).toBeGreaterThanOrEqual(Number(years[i]));
    }
  });

  it("returns organizations sorted alphabetically", () => {
    const orgs = getAvailableOrganizations(events);

    expect(orgs.length).toBeGreaterThan(0);
    for (let i = 1; i < orgs.length; i++) {
      expect(orgs[i] >= orgs[i - 1]).toBe(true);
    }
  });

  it("formats day precision dates", () => {
    expect(formatEventDate("2025-01-20", "day")).toBe("Jan 20, 2025");
  });

  it("formats month precision dates", () => {
    expect(formatEventDate("2025-09", "month")).toBe("Sep 2025");
  });

  it("formats short day precision dates", () => {
    expect(formatEventDateShort("2025-01-20", "day")).toBe("Jan 20");
  });

  it("formats short month precision dates", () => {
    expect(formatEventDateShort("2025-09", "month")).toBe("Sep");
  });

  it("formats short year precision dates", () => {
    expect(formatEventDateShort("2025", "year")).toBe("2025");
  });
});
