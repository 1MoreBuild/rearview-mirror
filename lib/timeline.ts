import rawTimelineSource from "@/data/ai_timeline.json";
import { z } from "zod";

import {
  datePrecisionSchema,
  significanceSchema,
  sourceLinkSchema,
  timelineCategorySchema,
  timelineEventSchema,
  type TimelineEvent,
} from "@/lib/timeline-schema";

const rawEventSchema = z.object({
  date: z.string().regex(/^\d{4}(-\d{2}){0,2}$/),
  date_precision: datePrecisionSchema,
  category: timelineCategorySchema,
  significance: significanceSchema,
  title: z.string().min(1),
  organization: z.string().min(1),
  summary: z.string().min(1),
  detail: z.string().min(1),
  tags: z.array(z.string().min(1)).min(1),
  sources: z.array(sourceLinkSchema),
});

const sourceTimelineSchema = z.object({
  version: z.literal(2),
  as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  range_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  range_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  events: z.array(rawEventSchema),
});

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function toInternalEvent(
  rawEvent: z.infer<typeof rawEventSchema>,
  id: string,
): TimelineEvent {
  return {
    id,
    date: rawEvent.date,
    datePrecision: rawEvent.date_precision,
    category: rawEvent.category,
    significance: rawEvent.significance,
    title: rawEvent.title,
    organization: rawEvent.organization,
    summary: rawEvent.summary,
    detail: rawEvent.detail,
    tags: rawEvent.tags,
    sources: rawEvent.sources,
  };
}

const parsedSource = sourceTimelineSchema.safeParse(rawTimelineSource);

if (!parsedSource.success) {
  throw new Error(
    `Invalid source timeline data: ${parsedSource.error.message}`,
  );
}

const sourceData = parsedSource.data;

const idUsage = new Map<string, number>();

const normalizedEvents = sourceData.events.map((rawEvent) => {
  const baseId = `${rawEvent.date}-${slugify(rawEvent.title)}`;
  const idCount = idUsage.get(baseId) ?? 0;

  idUsage.set(baseId, idCount + 1);

  const id = idCount === 0 ? baseId : `${baseId}-${idCount + 1}`;
  return toInternalEvent(rawEvent, id);
});

const parsedInternalEvents = z
  .array(timelineEventSchema)
  .safeParse(normalizedEvents);

if (!parsedInternalEvents.success) {
  throw new Error(
    `Invalid normalized timeline data: ${parsedInternalEvents.error.message}`,
  );
}

const timelineEvents = parsedInternalEvents.data;

export type TimelineMeta = {
  asOf: string;
  rangeStart: string;
  rangeEnd: string;
  totalEvents: number;
  highSignificanceCount: number;
};

const timelineMeta: TimelineMeta = {
  asOf: sourceData.as_of,
  rangeStart: sourceData.range_start,
  rangeEnd: sourceData.range_end,
  totalEvents: timelineEvents.length,
  highSignificanceCount: timelineEvents.filter(
    (event) => event.significance === "high",
  ).length,
};

export function getTimelineEvents(): TimelineEvent[] {
  return timelineEvents;
}

export function getTimelineMeta(): TimelineMeta {
  return timelineMeta;
}
