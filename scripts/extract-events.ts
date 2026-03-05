/**
 * Extracts timeline events from RSS data using an LLM via OpenRouter.
 *
 * Incremental by default: reads as_of from existing ai_timeline.json and
 * only processes RSS items published after that date. Use --full to
 * reprocess everything.
 *
 * Every run produces an audit log in data/logs/ with full extraction details.
 *
 * Usage:
 *   OPENROUTER_API_KEY=sk-or-xxx pnpm exec tsx scripts/extract-events.ts
 *
 * Options:
 *   --full        Reprocess all RSS items (ignore existing data)
 *   --file PATH   Read RSS from a local XML file instead of fetching
 *   --limit N     Process only the first N new RSS items
 *   --dry-run     Print result to stdout without writing file
 */

import fs from "node:fs";
import path from "node:path";

import {
  type AuditExtractionLog,
  clampDateToMax,
  deduplicateEvents,
  type ExtractedEvent,
  loadExistingTimeline,
  maxDate,
  parsePubDate,
  parseRssItems,
  type RssItem,
  type TimelineFile,
  writeAuditLog,
} from "./extract-events.helpers";
import { chatCompletion, getModelName } from "./shared/openrouter-client";

const RSS_URL = process.env.RSS_FEED_URL ?? "https://news.smol.ai/rss.xml";
const OUTPUT_PATH = path.resolve(__dirname, "../data/ai_timeline.json");
const LOGS_DIR = path.resolve(__dirname, "../data/logs");

const SYSTEM_PROMPT = fs.readFileSync(
  path.resolve(__dirname, "shared/extraction-prompt.txt"),
  "utf-8",
);

const BATCH_SIZE = 10;
const SHORT_CONTENT_THRESHOLD = 2000;

async function fetchRss(localFile?: string): Promise<string> {
  if (localFile) {
    console.log(`Reading RSS from local file: ${localFile}`);
    const xml = fs.readFileSync(path.resolve(localFile), "utf-8");
    console.log(`Read ${(xml.length / 1024).toFixed(0)}KB`);
    return xml;
  }

  console.log(`Fetching RSS from: ${RSS_URL}`);
  const response = await fetch(RSS_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch RSS: ${response.status}`);
  }

  const xml = await response.text();
  console.log(`Fetched ${(xml.length / 1024).toFixed(0)}KB`);
  return xml;
}

function parseEventsFromResponse(response: string): ExtractedEvent[] {
  try {
    const cleaned = response
      .replace(/^```json?\s*/m, "")
      .replace(/```\s*$/m, "")
      .trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];

    return parsed.map((event: Record<string, unknown>) => ({
      ...event,
      significance: "low" as const,
      detail: event.detail || event.summary || "",
    }));
  } catch {
    return [];
  }
}

async function extractEventsFromItem(item: RssItem): Promise<ExtractedEvent[]> {
  const date = parsePubDate(item.pubDate);
  if (!date) return [];

  const userPrompt = `Newsletter date: ${date}
Newsletter title: ${item.title}
Newsletter URL: ${item.link}

Content:
${item.twitterRecap.slice(0, 12000)}`;

  const response = await chatCompletion(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    { temperature: 0.1, maxTokens: 4096 },
  );

  const events = parseEventsFromResponse(response);
  if (events.length === 0 && response.trim() !== "[]") {
    console.error(`  Failed to parse LLM response for: ${item.title}`);
  }
  return events;
}

async function extractEventsFromBatch(batch: RssItem[]): Promise<ExtractedEvent[]> {
  const sections = batch
    .map((item) => {
      const date = parsePubDate(item.pubDate);
      return `--- NEWSLETTER ---
Date: ${date}
Title: ${item.title}
URL: ${item.link}
Content: ${item.twitterRecap.slice(0, 1500)}`;
    })
    .join("\n\n");

  const userPrompt = `Below are ${batch.length} newsletter summaries. Extract release events from ALL of them into a single flat JSON array. Use each newsletter's date for its events.\n\n${sections}`;

  const response = await chatCompletion(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    { temperature: 0.1, maxTokens: 8192 },
  );

  const events = parseEventsFromResponse(response);
  if (events.length === 0 && response.trim() !== "[]") {
    console.error("  Failed to parse batch response");
  }
  return events;
}

function parseCliArgs(args: string[]): {
  limit: number;
  localFile?: string;
  dryRun: boolean;
  fullMode: boolean;
} {
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : Infinity;
  const fileIdx = args.indexOf("--file");
  const localFile = fileIdx !== -1 ? args[fileIdx + 1] : undefined;

  return {
    limit,
    localFile,
    dryRun: args.includes("--dry-run"),
    fullMode: args.includes("--full"),
  };
}

function initializeAuditLog(params: {
  timestamp: string;
  mode: "full" | "incremental";
  dryRun: boolean;
  limit: number | null;
  rssSource: string;
  totalRssItems: number;
  filteredRssItems: number;
  longItems: number;
  shortItems: number;
  batches: number;
}): AuditExtractionLog {
  return {
    timestamp: params.timestamp,
    model: getModelName(),
    config: {
      mode: params.mode,
      dryRun: params.dryRun,
      limit: params.limit,
      rssSource: params.rssSource,
      batchSize: BATCH_SIZE,
      shortContentThreshold: SHORT_CONTENT_THRESHOLD,
    },
    input: {
      totalRssItems: params.totalRssItems,
      filteredRssItems: params.filteredRssItems,
      longItems: params.longItems,
      shortItems: params.shortItems,
      batches: params.batches,
    },
    items: [],
    dedup: { beforeCount: 0, afterCount: 0, removedCount: 0, details: [] },
    result: { newEvents: 0, existingEvents: 0, totalAfterMerge: 0, dateRange: "" },
  };
}

async function main() {
  const { limit, localFile, dryRun, fullMode } = parseCliArgs(process.argv.slice(2));
  const runTimestamp = new Date().toISOString();

  console.log(`Model: ${getModelName()}`);

  const existing = fullMode ? null : loadExistingTimeline(OUTPUT_PATH);
  const cursor = existing?.as_of ?? "";

  if (cursor) {
    console.log(`Incremental mode: reprocessing items on/after ${cursor}`);
  } else {
    console.log("Full mode: processing all items");
  }

  const xml = await fetchRss(localFile);
  let items = parseRssItems(xml);
  const totalRssItems = items.length;
  console.log(`Found ${items.length} usable RSS items`);

  if (cursor) {
    const before = items.length;
    items = items.filter((item) => {
      const date = parsePubDate(item.pubDate);
      return date >= cursor;
    });
    console.log(
      `Filtered to ${items.length} candidate items (skipped ${before - items.length} older items)`,
    );
  }

  if (items.length === 0) {
    console.log("No new items to process. Data is up to date.");
    return;
  }

  const effectiveLimit = limit < items.length ? limit : null;
  if (effectiveLimit) {
    items = items.slice(0, effectiveLimit);
    console.log(`Limited to first ${effectiveLimit} items`);
  }

  const processedCursorDate = maxDate(items.map((item) => parsePubDate(item.pubDate)));
  const longItems = items.filter((i) => i.twitterRecap.length >= SHORT_CONTENT_THRESHOLD);
  const shortItems = items.filter((i) => i.twitterRecap.length < SHORT_CONTENT_THRESHOLD);
  const totalBatches = Math.ceil(shortItems.length / BATCH_SIZE);

  console.log(
    `Processing ${longItems.length} full-content items individually, ${shortItems.length} short items in batches of ${BATCH_SIZE}`,
  );

  const audit = initializeAuditLog({
    timestamp: runTimestamp,
    mode: fullMode ? "full" : "incremental",
    dryRun,
    limit: effectiveLimit,
    rssSource: localFile ?? RSS_URL,
    totalRssItems,
    filteredRssItems: items.length,
    longItems: longItems.length,
    shortItems: shortItems.length,
    batches: totalBatches,
  });

  const newEvents: ExtractedEvent[] = [];

  for (let i = 0; i < longItems.length; i++) {
    const item = longItems[i];
    const date = parsePubDate(item.pubDate);
    console.log(`[${i + 1}/${longItems.length}] ${date} - ${item.title.slice(0, 60)}...`);

    const events = await extractEventsFromItem(item);
    console.log(`  -> ${events.length} events extracted`);
    newEvents.push(...events);

    audit.items.push({
      rssTitle: item.title,
      pubDate: date,
      link: item.link,
      contentLength: item.twitterRecap.length,
      contentType: item.contentType,
      processingMode: "individual",
      eventsExtracted: events.map((e) => ({
        date: e.date,
        title: e.title,
        organization: e.organization,
        category: e.category,
      })),
    });
  }

  for (let i = 0; i < shortItems.length; i += BATCH_SIZE) {
    const batch = shortItems.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const dateRange = `${parsePubDate(batch[batch.length - 1].pubDate)} to ${parsePubDate(batch[0].pubDate)}`;
    console.log(`[batch ${batchNum}/${totalBatches}] ${batch.length} items (${dateRange})`);

    const events = await extractEventsFromBatch(batch);
    console.log(`  -> ${events.length} events extracted`);
    newEvents.push(...events);

    for (const item of batch) {
      const date = parsePubDate(item.pubDate);
      const itemEvents = events.filter((e) => e.date === date);
      audit.items.push({
        rssTitle: item.title,
        pubDate: date,
        link: item.link,
        contentLength: item.twitterRecap.length,
        contentType: item.contentType,
        processingMode: "batch",
        batchIndex: batchNum,
        eventsExtracted: itemEvents.map((e) => ({
          date: e.date,
          title: e.title,
          organization: e.organization,
          category: e.category,
        })),
      });
    }
  }

  const allEvents = [...(existing?.events ?? []), ...newEvents];
  const { result: mergedEvents, details: dedupDetails } = deduplicateEvents(allEvents);

  audit.dedup = {
    beforeCount: allEvents.length,
    afterCount: mergedEvents.length,
    removedCount: allEvents.length - mergedEvents.length,
    details: dedupDetails,
  };

  mergedEvents.sort((a, b) => a.date.localeCompare(b.date));

  const dates = mergedEvents.map((e) => e.date).sort();
  const today = new Date().toISOString().slice(0, 10);
  const rawNextCursor = maxDate([cursor, processedCursorDate]);
  const nextCursor = clampDateToMax(rawNextCursor, today) || today;

  const output: TimelineFile = {
    version: 2,
    as_of: nextCursor,
    range_start: existing?.range_start ?? dates[0] ?? today,
    range_end: dates[dates.length - 1] ?? today,
    events: mergedEvents,
  };

  const dateRange = `${output.range_start} to ${output.range_end}`;
  audit.result = {
    newEvents: newEvents.length,
    existingEvents: existing?.events.length ?? 0,
    totalAfterMerge: mergedEvents.length,
    dateRange,
  };

  console.log(
    `\nResult: ${newEvents.length} new + ${existing?.events.length ?? 0} existing = ${mergedEvents.length} total (after dedup)`,
  );

  if (dryRun) {
    console.log("\n--- DRY RUN OUTPUT ---");
    console.log(JSON.stringify(output, null, 2));
  } else {
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + "\n", "utf-8");
    console.log(`Wrote ${mergedEvents.length} events to ${OUTPUT_PATH}`);
  }

  const logPath = writeAuditLog(audit, LOGS_DIR);
  console.log(`Audit log: ${logPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
