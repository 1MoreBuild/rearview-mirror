import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import rawTimelineSource from "@/data/ai_timeline.json";
import rawPelicanSource from "@/data/pelican_timeline.json";
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

const rawPelicanEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  model: z.string().min(1),
  provider: z.string().min(1),
  svg_files: z.array(z.string().min(1)).min(1),
  blog_url: z.string().url().optional(),
  notes: z.string().optional(),
});

const sourcePelicanSchema = z.object({
  version: z.literal(1),
  entries: z.array(rawPelicanEntrySchema),
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

function pelicanToTimelineEvent(
  raw: z.infer<typeof rawPelicanEntrySchema>,
  id: string,
): TimelineEvent {
  const sources: { label: string; url: string }[] = [];
  if (raw.blog_url) {
    sources.push({ label: "Blog post", url: raw.blog_url });
  }

  return {
    id,
    date: raw.date,
    datePrecision: "day",
    category: "pelican",
    significance: "low",
    title: raw.model,
    organization: raw.provider,
    summary: raw.notes ?? `${raw.model} takes the pelican-on-a-bicycle SVG benchmark.`,
    detail: `Simon Willison's informal benchmark: "Generate an SVG of a pelican riding a bicycle."`,
    tags: ["pelican", raw.provider.toLowerCase()],
    sources,
    svgFiles: raw.svg_files,
  };
}

// --- Load main timeline ---

const parsedSource = sourceTimelineSchema.safeParse(rawTimelineSource);

if (!parsedSource.success) {
  throw new Error(
    `Invalid source timeline data: ${parsedSource.error.message}`,
  );
}

const sourceData = parsedSource.data;

const idUsage = new Map<string, number>();

function makeUniqueId(baseId: string): string {
  const count = idUsage.get(baseId) ?? 0;
  idUsage.set(baseId, count + 1);
  return count === 0 ? baseId : `${baseId}-${count + 1}`;
}

const normalizedEvents = sourceData.events.map((rawEvent) => {
  const baseId = `${rawEvent.date}-${slugify(rawEvent.title)}`;
  return toInternalEvent(rawEvent, makeUniqueId(baseId));
});

// --- Load pelican entries ---

const parsedPelican = sourcePelicanSchema.safeParse(rawPelicanSource);

if (!parsedPelican.success) {
  throw new Error(
    `Invalid pelican timeline data: ${parsedPelican.error.message}`,
  );
}

const pelicanEvents = parsedPelican.data.entries.map((raw) => {
  const baseId = `${raw.date}-${slugify(raw.model)}`;
  return pelicanToTimelineEvent(raw, makeUniqueId(baseId));
});

// --- Merge and validate ---

const allEvents = [...normalizedEvents, ...pelicanEvents];

const parsedInternalEvents = z
  .array(timelineEventSchema)
  .safeParse(allEvents);

if (!parsedInternalEvents.success) {
  throw new Error(
    `Invalid normalized timeline data: ${parsedInternalEvents.error.message}`,
  );
}

const timelineEvents = parsedInternalEvents.data;

// --- SVG loading ---

const SCRIPT_RE = /<script[\s\S]*?<\/script\s*>/gi;
const FOREIGN_OBJECT_RE = /<foreignObject[\s\S]*?<\/foreignObject\s*>/gi;
const ON_HANDLER_RE = /\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const JS_URI_RE = /\s+(href|xlink:href)\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi;
const SVG_OPEN_RE = /^(<svg\b[^>]*>)/i;
const VIEWBOX_RE = /\bviewBox\s*=/i;
const WIDTH_RE = /\bwidth="(\d+(?:\.\d+)?)"/i;
const HEIGHT_RE = /\bheight="(\d+(?:\.\d+)?)"/i;

function ensureViewBox(svg: string): string {
  const openMatch = SVG_OPEN_RE.exec(svg);
  if (!openMatch) return svg;
  const tag = openMatch[1];
  if (VIEWBOX_RE.test(tag)) return svg;

  const w = WIDTH_RE.exec(tag)?.[1];
  const h = HEIGHT_RE.exec(tag)?.[1];
  if (!w || !h) return svg;

  const newTag = tag.replace(/>$/, ` viewBox="0 0 ${w} ${h}">`);
  return svg.replace(tag, newTag);
}

function sanitizeSvg(raw: string): string {
  let cleaned = raw;
  cleaned = cleaned.replace(SCRIPT_RE, "");
  cleaned = cleaned.replace(FOREIGN_OBJECT_RE, "");
  cleaned = cleaned.replace(ON_HANDLER_RE, "");
  cleaned = cleaned.replace(JS_URI_RE, "");
  return ensureViewBox(cleaned);
}

function loadSvgContent(filename: string): string {
  const svgPath = join(process.cwd(), "public", "pelican-svgs", filename);
  try {
    const raw = readFileSync(svgPath, "utf-8");
    return sanitizeSvg(raw);
  } catch {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><text x="100" y="100" text-anchor="middle" fill="#999" font-size="14">SVG not found</text></svg>`;
  }
}

const svgContents: Record<string, string> = {};
for (const event of timelineEvents) {
  if (event.svgFiles) {
    for (const file of event.svgFiles) {
      svgContents[file] = loadSvgContent(file);
    }
  }
}

// --- Raster image fallback detection ---
// For pelican entries, check if a PNG/JPG exists alongside the SVG placeholder

const RASTER_EXTENSIONS = [".png", ".jpg", ".webp"];

function detectRasterFallback(svgFilename: string): string | null {
  const baseName = svgFilename.replace(/\.svg$/, "");
  for (const ext of RASTER_EXTENSIONS) {
    const rasterPath = join(process.cwd(), "public", "pelican-svgs", baseName + ext);
    if (existsSync(rasterPath)) {
      return `/pelican-svgs/${baseName}${ext}`;
    }
  }
  return null;
}

const rasterFallbacks: Record<string, string> = {};
for (const event of timelineEvents) {
  if (event.svgFiles && event.category === "pelican") {
    for (const file of event.svgFiles) {
      const svg = svgContents[file];
      if (svg && svg.includes("placeholder")) {
        const fallback = detectRasterFallback(file);
        if (fallback) {
          rasterFallbacks[file] = fallback;
        }
      }
    }
  }
}

// --- Exports ---

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

export function getSvgContents(): Record<string, string> {
  return svgContents;
}

/** Maps svgFile → public path for entries where SVG is placeholder but a PNG/JPG exists */
export function getRasterFallbacks(): Record<string, string> {
  return rasterFallbacks;
}
