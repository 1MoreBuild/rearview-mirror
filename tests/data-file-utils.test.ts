import { describe, it, expect } from "vitest";
import { insertEvents, getDataFileName } from "../scripts/shared/data-file-utils";
import type { SourceTimeline, RawEvent } from "../scripts/shared/raw-event-schema";

function makeTimeline(overrides: Partial<SourceTimeline> = {}): SourceTimeline {
  return {
    as_of: "2026-02-24",
    timezone: "America/Los_Angeles",
    range_start: "2025-01-01",
    range_end_inclusive: "2026-02-24",
    scope_note: "Test timeline",
    impact_legend: {
      watershed: "Industry moment",
      high: "Widely adopted",
      medium: "Important to practitioners",
      low: "Niche",
    },
    context_before_2025: [],
    months: [
      {
        month: "2025-01",
        events: [
          {
            date: "2025-01-20",
            date_precision: "day",
            title: "Existing event",
            organization: "TestOrg",
            model_family: "TestModel",
            modalities: ["text"],
            release_type: "api",
            description: "An existing event.",
            why_it_mattered: "It mattered.",
            network_impact: { level: "high", markers: ["test"] },
            sources: [{ label: "Source", url: "https://example.com" }],
          },
        ],
      },
    ],
    ...overrides,
  };
}

function makeEvent(overrides: Partial<RawEvent> = {}): RawEvent {
  return {
    date: "2026-03-01",
    date_precision: "day",
    title: "New Model released",
    organization: "NewOrg",
    model_family: "NewModel",
    modalities: ["text"],
    release_type: "open-weights",
    description: "A new model.",
    why_it_mattered: "It was new.",
    network_impact: { level: "medium", markers: ["new"] },
    sources: [{ label: "Source", url: "https://example.com/new" }],
    ...overrides,
  };
}

describe("insertEvents", () => {
  it("inserts event into existing month", () => {
    const data = makeTimeline();
    const event = makeEvent({ date: "2025-01-25", model_family: "Another" });
    const result = insertEvents(data, [event]);

    expect(result.months[0].events).toHaveLength(2);
    expect(result.months[0].events[1].title).toBe("New Model released");
  });

  it("creates new month bucket when needed", () => {
    const data = makeTimeline();
    const event = makeEvent({ date: "2026-03-15" });
    const result = insertEvents(data, [event]);

    expect(result.months).toHaveLength(2);
    expect(result.months[1].month).toBe("2026-03");
    expect(result.months[1].events).toHaveLength(1);
  });

  it("keeps months sorted chronologically", () => {
    const data = makeTimeline();
    const event1 = makeEvent({ date: "2026-05-01" });
    const event2 = makeEvent({ date: "2025-06-01" });
    const result = insertEvents(data, [event1, event2]);

    const monthKeys = result.months.map((m) => m.month);
    expect(monthKeys).toEqual(["2025-01", "2025-06", "2026-05"]);
  });

  it("sorts events within month by date", () => {
    const data = makeTimeline();
    const event1 = makeEvent({ date: "2025-01-10", model_family: "Early" });
    const event2 = makeEvent({ date: "2025-01-30", model_family: "Late" });
    const result = insertEvents(data, [event2, event1]);

    const dates = result.months[0].events.map((e) => e.date);
    expect(dates).toEqual(["2025-01-10", "2025-01-20", "2025-01-30"]);
  });

  it("updates range_end_inclusive when new events extend the range", () => {
    const data = makeTimeline();
    const event = makeEvent({ date: "2026-04-01" });
    const result = insertEvents(data, [event]);

    expect(result.range_end_inclusive).toBe("2026-04-01");
  });

  it("does not shrink range_end_inclusive for older events", () => {
    const data = makeTimeline();
    const event = makeEvent({ date: "2025-01-05" });
    const result = insertEvents(data, [event]);

    expect(result.range_end_inclusive).toBe("2026-02-24");
  });

  it("updates as_of to today", () => {
    const data = makeTimeline({ as_of: "2026-01-01" });
    const event = makeEvent();
    const result = insertEvents(data, [event]);

    const today = new Date().toISOString().split("T")[0];
    expect(result.as_of).toBe(today);
  });
});

describe("getDataFileName", () => {
  it("generates correct filename from timeline data", () => {
    const data = makeTimeline();
    expect(getDataFileName(data)).toBe(
      "ai_model_timeline_2025-01_to_2026-02-24_en.json",
    );
  });

  it("reflects updated range_end_inclusive", () => {
    const data = makeTimeline({ range_end_inclusive: "2026-05-15" });
    expect(getDataFileName(data)).toBe(
      "ai_model_timeline_2025-01_to_2026-05-15_en.json",
    );
  });
});
