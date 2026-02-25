import { z } from "zod";

export const impactLevelSchema = z.enum(["high", "medium", "low"]);
export type ImpactLevel = z.infer<typeof impactLevelSchema>;

export const timelineCategorySchema = z.enum([
  "model",
  "product",
  "engineering",
  "culture",
]);
export type TimelineCategory = z.infer<typeof timelineCategorySchema>;

export const datePrecisionSchema = z.enum(["day", "month", "year"]);
export type DatePrecision = z.infer<typeof datePrecisionSchema>;

export const sourceLinkSchema = z.object({
  label: z.string().min(1),
  url: z.string().url(),
});
export type SourceLink = z.infer<typeof sourceLinkSchema>;

export const timelineEventSchema = z.object({
  id: z.string().min(1),
  date: z.string().regex(/^\d{4}(-\d{2}){0,2}$/),
  datePrecision: datePrecisionSchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  details: z.string().min(1),
  impact: impactLevelSchema,
  organization: z.string().min(1),
  tags: z.array(z.string().min(1)).min(1),
  sources: z.array(sourceLinkSchema).min(1),
  isKeyMoment: z.boolean(),
  category: timelineCategorySchema,
});
export type TimelineEvent = z.infer<typeof timelineEventSchema>;

export const modelTimelineEventSchema = timelineEventSchema.extend({
  category: z.literal("model"),
});

export type ModelTimelineEvent = z.infer<typeof modelTimelineEventSchema>;
