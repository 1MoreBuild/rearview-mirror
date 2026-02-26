import { z } from "zod";

export const timelineCategorySchema = z.enum([
  "model",
  "product",
  "engineering",
]);
export type TimelineCategory = z.infer<typeof timelineCategorySchema>;

export const significanceSchema = z.enum(["high", "low"]);
export type Significance = z.infer<typeof significanceSchema>;

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
  category: timelineCategorySchema,
  significance: significanceSchema,
  title: z.string().min(1),
  organization: z.string().min(1),
  summary: z.string().min(1),
  detail: z.string().min(1),
  tags: z.array(z.string().min(1)).min(1),
  sources: z.array(sourceLinkSchema),
});
export type TimelineEvent = z.infer<typeof timelineEventSchema>;
