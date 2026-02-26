import { describe, it, expect } from "vitest";
import { deduplicateEvents } from "../scripts/shared/dedup";
import type { RawEvent } from "../scripts/shared/raw-event-schema";

function makeEvent(overrides: Partial<RawEvent> = {}): RawEvent {
  return {
    date: "2025-03-01",
    date_precision: "day",
    title: "Test Model released",
    organization: "TestOrg",
    model_family: "TestModel",
    modalities: ["text"],
    release_type: "api",
    description: "A test model was released.",
    why_it_mattered: "It was important for testing.",
    network_impact: { level: "medium", markers: ["test"] },
    sources: [{ label: "Test Source", url: "https://example.com" }],
    ...overrides,
  };
}

describe("deduplicateEvents", () => {
  it("removes exact duplicates by date+org+model_family", () => {
    const existing = [makeEvent()];
    const candidates = [makeEvent()];

    const result = deduplicateEvents(candidates, existing);
    expect(result).toHaveLength(0);
  });

  it("keeps events with different dates", () => {
    const existing = [makeEvent({ date: "2025-03-01" })];
    const candidates = [makeEvent({ date: "2025-03-02" })];

    const result = deduplicateEvents(candidates, existing);
    expect(result).toHaveLength(1);
  });

  it("keeps events with different organizations", () => {
    const existing = [makeEvent({ organization: "OrgA" })];
    const candidates = [makeEvent({ organization: "OrgB" })];

    const result = deduplicateEvents(candidates, existing);
    expect(result).toHaveLength(1);
  });

  it("keeps events with different model families", () => {
    const existing = [makeEvent({ model_family: "ModelA" })];
    const candidates = [makeEvent({ model_family: "ModelB" })];

    const result = deduplicateEvents(candidates, existing);
    expect(result).toHaveLength(1);
  });

  it("is case-insensitive for org and model_family", () => {
    const existing = [
      makeEvent({ organization: "DeepSeek", model_family: "DeepSeek-R1" }),
    ];
    const candidates = [
      makeEvent({ organization: "deepseek", model_family: "deepseek-r1" }),
    ];

    const result = deduplicateEvents(candidates, existing);
    expect(result).toHaveLength(0);
  });

  it("handles empty candidates", () => {
    const existing = [makeEvent()];
    const result = deduplicateEvents([], existing);
    expect(result).toHaveLength(0);
  });

  it("handles empty existing", () => {
    const candidates = [makeEvent()];
    const result = deduplicateEvents(candidates, []);
    expect(result).toHaveLength(1);
  });

  it("deduplicates mixed batch of new and existing", () => {
    const existing = [
      makeEvent({ date: "2025-01-01", model_family: "Alpha" }),
      makeEvent({ date: "2025-02-01", model_family: "Beta" }),
    ];
    const candidates = [
      makeEvent({ date: "2025-01-01", model_family: "Alpha" }), // duplicate
      makeEvent({ date: "2025-03-01", model_family: "Gamma" }), // new
      makeEvent({ date: "2025-02-01", model_family: "Beta" }),  // duplicate
      makeEvent({ date: "2025-04-01", model_family: "Delta" }), // new
    ];

    const result = deduplicateEvents(candidates, existing);
    expect(result).toHaveLength(2);
    expect(result[0].model_family).toBe("Gamma");
    expect(result[1].model_family).toBe("Delta");
  });
});
