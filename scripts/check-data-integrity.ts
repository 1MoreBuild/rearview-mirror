import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const AI_TIMELINE_PATH = path.resolve(__dirname, "../data/ai_timeline.json");
const PELICAN_TIMELINE_PATH = path.resolve(
  __dirname,
  "../data/pelican_timeline.json",
);
const SVG_DIR = path.resolve(__dirname, "../public/pelican-svgs");

const dayDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timelineDateSchema = z.string().regex(/^\d{4}(-\d{2}){0,2}$/);

const sourceSchema = z.object({
  label: z.string().min(1),
  url: z.string().url(),
});

const aiEventSchema = z.object({
  date: timelineDateSchema,
  date_precision: z.enum(["day", "month", "year"]),
  category: z.enum(["model", "product", "engineering"]),
  significance: z.enum(["high", "low"]),
  title: z.string().min(1),
  organization: z.string().min(1),
  summary: z.string().min(1),
  detail: z.string().min(1),
  tags: z.array(z.string().min(1)).min(1),
  sources: z.array(sourceSchema),
});

const aiTimelineSchema = z.object({
  version: z.literal(2),
  as_of: dayDateSchema,
  range_start: dayDateSchema,
  range_end: dayDateSchema,
  events: z.array(aiEventSchema),
});

const pelicanEntrySchema = z.object({
  date: dayDateSchema,
  model: z.string().min(1),
  provider: z.string().min(1),
  svg_files: z.array(z.string().min(1)).min(1),
  blog_url: z.string().url().optional(),
  notes: z.string().optional(),
});

const pelicanTimelineSchema = z.object({
  version: z.literal(1),
  entries: z.array(pelicanEntrySchema),
});

function loadJson(pathname: string): unknown {
  return JSON.parse(fs.readFileSync(pathname, "utf-8"));
}

function checkAscendingByDate(
  values: string[],
  label: string,
  errors: string[],
): void {
  for (let i = 1; i < values.length; i++) {
    if (values[i - 1] > values[i]) {
      errors.push(`${label} is not sorted ascending at index ${i - 1} -> ${i}`);
      return;
    }
  }
}

function checkAiTimeline(errors: string[]): void {
  const parsed = aiTimelineSchema.safeParse(loadJson(AI_TIMELINE_PATH));
  if (!parsed.success) {
    errors.push(`ai_timeline schema invalid: ${parsed.error.issues[0]?.message ?? "unknown error"}`);
    return;
  }

  const data = parsed.data;

  if (data.range_start > data.range_end) {
    errors.push("ai_timeline range_start is after range_end");
  }
  if (data.as_of < data.range_end) {
    errors.push("ai_timeline as_of is earlier than range_end");
  }

  checkAscendingByDate(
    data.events.map((event) => event.date),
    "ai_timeline events",
    errors,
  );

  const seen = new Set<string>();
  for (const event of data.events) {
    const key = `${event.date}|${event.organization}|${event.title}`;
    if (seen.has(key)) {
      errors.push(`duplicate ai_timeline event key: ${key}`);
      break;
    }
    seen.add(key);
  }
}

function checkPelicanTimeline(errors: string[]): void {
  const parsed = pelicanTimelineSchema.safeParse(loadJson(PELICAN_TIMELINE_PATH));
  if (!parsed.success) {
    errors.push(`pelican_timeline schema invalid: ${parsed.error.issues[0]?.message ?? "unknown error"}`);
    return;
  }

  const data = parsed.data;
  checkAscendingByDate(
    data.entries.map((entry) => entry.date),
    "pelican_timeline entries",
    errors,
  );

  const seen = new Set<string>();
  for (const entry of data.entries) {
    const key = `${entry.date}|${entry.model}`;
    if (seen.has(key)) {
      errors.push(`duplicate pelican entry key: ${key}`);
      break;
    }
    seen.add(key);

    for (const svgFile of entry.svg_files) {
      const svgPath = path.join(SVG_DIR, svgFile);
      if (!fs.existsSync(svgPath)) {
        errors.push(`missing pelican asset: ${svgFile} (entry: ${key})`);
      }
    }
  }
}

function checkTrackedGeneratedData(errors: string[]): void {
  const stdout = execFileSync(
    "git",
    ["ls-files", "data/logs", "data/pelican-cache"],
    { encoding: "utf8" },
  );

  const tracked = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (tracked.length > 0) {
    errors.push(
      `generated paths are tracked by git: ${tracked.join(", ")}`,
    );
  }
}

function main(): void {
  const errors: string[] = [];

  checkAiTimeline(errors);
  checkPelicanTimeline(errors);
  checkTrackedGeneratedData(errors);

  if (errors.length === 0) {
    return;
  }

  console.error("Data integrity checks failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

main();
