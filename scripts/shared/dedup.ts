import type { RawEvent } from "./raw-event-schema.js";

function eventDedupKey(event: RawEvent): string {
  const date = event.date;
  const org = event.organization.toLowerCase().trim();
  const family = event.model_family.toLowerCase().trim();
  return `${date}|${org}|${family}`;
}

export function deduplicateEvents(
  candidates: RawEvent[],
  existing: RawEvent[],
): RawEvent[] {
  const existingKeys = new Set(existing.map(eventDedupKey));
  return candidates.filter((event) => !existingKeys.has(eventDedupKey(event)));
}
