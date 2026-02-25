import rawTimelineSource from "@/data/ai_model_timeline_2025-01_to_2026-02-24_en.json";
import { z } from "zod";

import {
  modelTimelineEventSchema,
  sourceLinkSchema,
  type ModelTimelineEvent,
} from "@/lib/timeline-schema";

const rawImpactSchema = z.enum(["watershed", "high", "medium", "low"]);

const rawEventSchema = z.object({
  date: z.string().regex(/^\d{4}(-\d{2}){1,2}$/),
  date_precision: z.enum(["day", "month", "year"]),
  title: z.string().min(1),
  organization: z.string().min(1),
  model_family: z.string().min(1),
  modalities: z.array(z.string().min(1)).min(1),
  release_type: z.string().min(1),
  description: z.string().min(1),
  why_it_mattered: z.string().min(1),
  network_impact: z.object({
    level: rawImpactSchema,
    markers: z.array(z.string().min(1)).min(1),
  }),
  sources: z.array(sourceLinkSchema).min(1),
});

const sourceTimelineSchema = z.object({
  as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timezone: z.string().min(1),
  range_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  range_end_inclusive: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  scope_note: z.string().min(1),
  impact_legend: z.record(z.string().min(1), z.string().min(1)),
  context_before_2025: z.array(rawEventSchema),
  months: z.array(
    z.object({
      month: z.string().regex(/^\d{4}-\d{2}$/),
      events: z.array(rawEventSchema),
    }),
  ),
});

const impactMap = {
  watershed: "high",
  high: "high",
  medium: "medium",
  low: "low",
} as const;

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function toInternalEvent(
  rawEvent: z.infer<typeof rawEventSchema>,
  id: string,
): ModelTimelineEvent {
  const details = [
    rawEvent.why_it_mattered,
    `Model family: ${rawEvent.model_family}.`,
    `Release type: ${rawEvent.release_type}.`,
    `Modalities: ${rawEvent.modalities.join(", ")}.`,
  ].join(" ");

  return {
    id,
    date: rawEvent.date,
    datePrecision: rawEvent.date_precision,
    title: rawEvent.title,
    summary: rawEvent.description,
    details,
    impact: impactMap[rawEvent.network_impact.level],
    organization: rawEvent.organization,
    tags: uniqueStrings([
      rawEvent.model_family,
      `release:${rawEvent.release_type}`,
      ...rawEvent.modalities.map((modality) => `modality:${modality}`),
      ...rawEvent.network_impact.markers,
    ]),
    sources: rawEvent.sources,
    isKeyMoment: rawEvent.network_impact.level === "watershed",
    category: "model",
  };
}

const parsedSource = sourceTimelineSchema.safeParse(rawTimelineSource);

if (!parsedSource.success) {
  throw new Error(
    `Invalid source timeline data: ${parsedSource.error.message}`,
  );
}

const sourceData = parsedSource.data;
const flattenedRawEvents = [
  ...sourceData.context_before_2025,
  ...sourceData.months.flatMap((month) => month.events),
];

const idUsage = new Map<string, number>();

const normalizedEvents = flattenedRawEvents.map((rawEvent) => {
  const baseId = `${rawEvent.date}-${slugify(rawEvent.model_family)}`;
  const idCount = idUsage.get(baseId) ?? 0;

  idUsage.set(baseId, idCount + 1);

  const id = idCount === 0 ? baseId : `${baseId}-${idCount + 1}`;
  return toInternalEvent(rawEvent, id);
});

const parsedInternalEvents = z
  .array(modelTimelineEventSchema)
  .safeParse(normalizedEvents);

if (!parsedInternalEvents.success) {
  throw new Error(
    `Invalid normalized timeline data: ${parsedInternalEvents.error.message}`,
  );
}

const modelEvents = parsedInternalEvents.data;

export type ModelTimelineMeta = {
  asOf: string;
  timezone: string;
  rangeStart: string;
  rangeEndInclusive: string;
  scopeNote: string;
  totalEvents: number;
  monthCount: number;
  contextCount: number;
  keyMomentCount: number;
};

const timelineMeta: ModelTimelineMeta = {
  asOf: sourceData.as_of,
  timezone: sourceData.timezone,
  rangeStart: sourceData.range_start,
  rangeEndInclusive: sourceData.range_end_inclusive,
  scopeNote: sourceData.scope_note,
  totalEvents: modelEvents.length,
  monthCount: sourceData.months.length,
  contextCount: sourceData.context_before_2025.length,
  keyMomentCount: modelEvents.filter((event) => event.isKeyMoment).length,
};

export function getModelEvents(): ModelTimelineEvent[] {
  return modelEvents;
}

export function getModelTimelineMeta(): ModelTimelineMeta {
  return timelineMeta;
}
