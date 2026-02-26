import { z } from "zod";

export const sourceLinkSchema = z.object({
  label: z.string().min(1),
  url: z.string().url(),
});

export type SourceLink = z.infer<typeof sourceLinkSchema>;

export const rawImpactSchema = z.enum(["watershed", "high", "medium", "low"]);

export const rawEventSchema = z.object({
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

export type RawEvent = z.infer<typeof rawEventSchema>;

export const sourceTimelineSchema = z.object({
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

export type SourceTimeline = z.infer<typeof sourceTimelineSchema>;
