import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  sourceTimelineSchema,
  type SourceTimeline,
  type RawEvent,
} from "./raw-event-schema.js";

export function findCurrentDataFile(dataDir: string): string {
  const files = readdirSync(dataDir).filter(
    (f) => f.startsWith("ai_model_timeline_") && f.endsWith("_en.json"),
  );

  if (files.length === 0) {
    throw new Error(`No timeline data file found in ${dataDir}`);
  }

  // Sort by name to get the latest one
  files.sort();
  return join(dataDir, files[files.length - 1]);
}

export function readDataFile(filePath: string): SourceTimeline {
  const raw = JSON.parse(readFileSync(filePath, "utf-8"));
  const parsed = sourceTimelineSchema.safeParse(raw);

  if (!parsed.success) {
    throw new Error(
      `Invalid data file ${filePath}: ${parsed.error.message}`,
    );
  }

  return parsed.data;
}

function getMonthKey(date: string): string {
  // "2026-02-25" → "2026-02", "2026-02" → "2026-02"
  return date.substring(0, 7);
}

export function insertEvents(
  data: SourceTimeline,
  newEvents: RawEvent[],
): SourceTimeline {
  const result = structuredClone(data);

  for (const event of newEvents) {
    const monthKey = getMonthKey(event.date);

    let monthBucket = result.months.find((m) => m.month === monthKey);
    if (!monthBucket) {
      monthBucket = { month: monthKey, events: [] };
      result.months.push(monthBucket);
      // Keep months sorted chronologically
      result.months.sort((a, b) => a.month.localeCompare(b.month));
    }

    monthBucket.events.push(event);
    // Sort events within month by date
    monthBucket.events.sort((a, b) => a.date.localeCompare(b.date));
  }

  // Update metadata
  const allDates = [
    ...result.context_before_2025.map((e) => e.date),
    ...result.months.flatMap((m) => m.events.map((e) => e.date)),
  ].sort();

  const latestDate = allDates[allDates.length - 1];
  const today = new Date().toISOString().split("T")[0];

  result.as_of = today;
  if (latestDate > result.range_end_inclusive) {
    result.range_end_inclusive = latestDate;
  }

  return result;
}

export function writeDataFile(
  currentPath: string,
  data: SourceTimeline,
): string {
  const dir = currentPath.substring(0, currentPath.lastIndexOf("/"));
  const rangeStart = data.range_start.substring(0, 7); // "2025-01"
  const newFileName = `ai_model_timeline_${rangeStart}_to_${data.range_end_inclusive}_en.json`;
  const newPath = join(dir, newFileName);

  const json = JSON.stringify(data, null, 2) + "\n";

  if (newPath !== currentPath) {
    // File needs renaming (date range expanded)
    writeFileSync(newPath, json, "utf-8");
    // Don't delete old file here — let git handle the rename via the PR script
  } else {
    writeFileSync(currentPath, json, "utf-8");
  }

  return newPath;
}

export function getDataFileName(data: SourceTimeline): string {
  const rangeStart = data.range_start.substring(0, 7);
  return `ai_model_timeline_${rangeStart}_to_${data.range_end_inclusive}_en.json`;
}

export function getAllExistingEvents(data: SourceTimeline): RawEvent[] {
  return [
    ...data.context_before_2025,
    ...data.months.flatMap((m) => m.events),
  ];
}
