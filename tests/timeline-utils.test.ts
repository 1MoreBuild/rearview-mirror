import { describe, expect, it } from "vitest";

import { getModelEvents } from "@/lib/timeline";
import {
  filterEvents,
  formatEventDate,
  getAvailableYears,
  sortEventsNewestFirst,
} from "@/lib/timeline-utils";

const events = getModelEvents();

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
  it("loads all normalized model events", () => {
    expect(events.length).toBeGreaterThanOrEqual(50);
    expect(events.every((event) => event.category === "model")).toBe(true);
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
    const filtered = filterEvents(sorted, {
      query: "",
      year: "2025",
      impact: "all",
    });

    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((event) => event.date.startsWith("2025"))).toBe(true);
  });

  it("filters by impact", () => {
    const sorted = sortEventsNewestFirst(events);
    const filtered = filterEvents(sorted, {
      query: "",
      year: "all",
      impact: "high",
    });

    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((event) => event.impact === "high")).toBe(true);
  });

  it("searches across title, organization, and tags", () => {
    const sorted = sortEventsNewestFirst(events);
    const filtered = filterEvents(sorted, {
      query: "deepseek",
      year: "all",
      impact: "all",
    });

    expect(filtered.length).toBeGreaterThan(0);
    expect(
      filtered.every(
        (event) =>
          event.title.toLowerCase().includes("deepseek") ||
          event.organization.toLowerCase().includes("deepseek") ||
          event.tags.join(" ").toLowerCase().includes("deepseek"),
      ),
    ).toBe(true);
  });

  it("returns years in descending order", () => {
    const years = getAvailableYears(events);

    expect(years[0]).toBe("2026");
    expect(years[years.length - 1]).toBe("2024");
  });

  it("formats day precision dates", () => {
    expect(formatEventDate("2025-01-20", "day")).toBe("Jan 20, 2025");
  });

  it("formats month precision dates", () => {
    expect(formatEventDate("2025-09", "month")).toBe("Sep 2025");
  });
});
