/**
 * Extracts timeline events from RSS data using an LLM via OpenRouter.
 *
 * Incremental by default: reads as_of from existing ai_timeline.json and
 * only processes RSS items published after that date. Use --full to
 * reprocess everything.
 *
 * Usage:
 *   OPENROUTER_API_KEY=sk-or-xxx npx tsx scripts/extract-events.ts
 *
 * Options:
 *   --full        Reprocess all RSS items (ignore existing data)
 *   --file PATH   Read RSS from a local XML file instead of fetching
 *   --limit N     Process only the first N new RSS items
 *   --dry-run     Print result to stdout without writing file
 */

import fs from "node:fs";
import path from "node:path";

import { chatCompletion, getModelName } from "./shared/openrouter-client";

const RSS_URL = process.env.RSS_FEED_URL ?? "https://news.smol.ai/rss.xml";
const OUTPUT_PATH = path.resolve(__dirname, "../data/ai_timeline.json");

// ─── Types ──────────────────────────────────────────────────────────────────

type RssItem = {
  title: string;
  pubDate: string;
  link: string;
  twitterRecap: string;
};

type ExtractedEvent = {
  date: string;
  date_precision: "day" | "month" | "year";
  category: "model" | "product" | "engineering";
  significance: "high" | "low";
  title: string;
  organization: string;
  summary: string;
  detail: string;
  tags: string[];
  sources: { label: string; url: string }[];
};

type TimelineFile = {
  version: number;
  as_of: string;
  range_start: string;
  range_end: string;
  events: ExtractedEvent[];
};

// ─── RSS fetching & parsing ─────────────────────────────────────────────────

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

function stripHtml(html: string): string {
  return html
    .replace(/<a\s[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseRssItems(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;

  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];

    const title = block.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() ?? "";
    const pubDate =
      block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() ?? "";
    const link = block.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() ?? "";

    // Extract content:encoded
    const encoded =
      block.match(
        /<content:encoded>([\s\S]*?)<\/content:encoded>/,
      )?.[1] ?? "";

    // Try to extract Twitter Recap section from full content
    const recapStart = encoded.indexOf("AI Twitter Recap");
    if (recapStart !== -1) {
      const afterHeader = encoded.indexOf("</h1>", recapStart);
      const nextH1 = encoded.indexOf("<h1>", afterHeader + 5);
      const recapHtml =
        nextH1 === -1
          ? encoded.slice(recapStart)
          : encoded.slice(recapStart, nextH1);

      const twitterRecap = stripHtml(recapHtml);
      if (twitterRecap.length >= 100) {
        items.push({ title, pubDate, link, twitterRecap });
        continue;
      }
    }

    // Fall back to <description> for items without full content
    const description =
      block.match(/<description>([\s\S]*?)<\/description>/)?.[1]?.trim() ?? "";
    if (description) {
      const descText = stripHtml(description);
      if (descText.length >= 80) {
        items.push({ title, pubDate, link, twitterRecap: descText });
      }
    }
  }

  return items;
}

function parsePubDate(pubDate: string): string {
  const d = new Date(pubDate);
  if (isNaN(d.getTime())) return "";
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// ─── Existing data ──────────────────────────────────────────────────────────

function loadExistingTimeline(): TimelineFile | null {
  if (!fs.existsSync(OUTPUT_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf-8"));
  } catch {
    return null;
  }
}

// ─── LLM extraction ────────────────────────────────────────────────────────

const SYSTEM_PROMPT = fs.readFileSync(
  path.resolve(__dirname, "shared/extraction-prompt.txt"),
  "utf-8",
);

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

async function extractEventsFromItem(
  item: RssItem,
): Promise<ExtractedEvent[]> {
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

/** Batch-extract events from multiple short items in a single LLM call. */
async function extractEventsFromBatch(
  batch: RssItem[],
): Promise<ExtractedEvent[]> {
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
    console.error(`  Failed to parse batch response`);
  }
  return events;
}

const BATCH_SIZE = 10;
const SHORT_CONTENT_THRESHOLD = 2000; // Items under this length get batched

// ─── Dedup & merge ──────────────────────────────────────────────────────────

function extractKeyTerms(title: string): string[] {
  return title
    .toLowerCase()
    // Normalize version-like patterns: "3.5" → "35", "qwen3.5" stays "qwen35"
    .replace(/(\d)\.(\d)/g, "$1$2")
    .replace(/[^a-z0-9\s]/g, " ")
    // Collapse adjacent number+word fragments: "qwen 35" → "qwen35"
    .replace(/([a-z])(\s+)(\d)/g, "$1$3")
    .split(/\s+/)
    .filter((w) => w.length > 1)
    // Drop generic filler words
    .filter(
      (w) =>
        ![
          "the", "with", "for", "via", "and", "new", "from",
          "released", "launches", "ships", "announces", "introduces",
          "model", "open", "source", "weight", "series", "medium",
          "architecture", "long", "context", "moe", "fp8", "weights",
        ].includes(w),
    );
}

function eventsOverlap(a: ExtractedEvent, b: ExtractedEvent): boolean {
  const termsA = new Set(extractKeyTerms(a.title));
  const termsB = new Set(extractKeyTerms(b.title));
  const intersection = [...termsA].filter((t) => termsB.has(t));
  const smaller = Math.min(termsA.size, termsB.size);
  if (smaller === 0) return false;

  const overlap = intersection.length / smaller;

  // Very high title overlap (≥80%) — treat as dup regardless of org
  // (handles cases where different sources attribute to different orgs)
  if (overlap >= 0.8) return true;

  // Moderate overlap (≥50%) requires same org
  const orgA = a.organization.toLowerCase();
  const orgB = b.organization.toLowerCase();
  const sameOrg = orgA.includes(orgB) || orgB.includes(orgA);
  return sameOrg && overlap >= 0.5;
}

function deduplicateEvents(events: ExtractedEvent[]): ExtractedEvent[] {
  const result: ExtractedEvent[] = [];

  for (const event of events) {
    const dupIndex = result.findIndex((existing) =>
      eventsOverlap(existing, event),
    );

    if (dupIndex !== -1) {
      const existing = result[dupIndex];
      // Keep the one with higher significance, or earlier date
      if (
        event.significance === "high" && existing.significance !== "high"
      ) {
        result[dupIndex] = event;
      } else if (
        event.significance === existing.significance &&
        event.date < existing.date
      ) {
        result[dupIndex] = event;
      }
      continue;
    }
    result.push(event);
  }

  return result;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : Infinity;
  const fileIdx = args.indexOf("--file");
  const localFile = fileIdx !== -1 ? args[fileIdx + 1] : undefined;
  const dryRun = args.includes("--dry-run");
  const fullMode = args.includes("--full");

  console.log(`Model: ${getModelName()}`);

  // Load existing data for incremental mode
  const existing = fullMode ? null : loadExistingTimeline();
  const cursor = existing?.as_of ?? "";

  if (cursor) {
    console.log(`Incremental mode: processing items after ${cursor}`);
  } else {
    console.log(`Full mode: processing all items`);
  }

  // Fetch and parse RSS
  const xml = await fetchRss(localFile);
  let items = parseRssItems(xml);
  console.log(`Found ${items.length} usable RSS items`);

  // Filter to only new items (pubDate > as_of)
  if (cursor) {
    const before = items.length;
    items = items.filter((item) => {
      const date = parsePubDate(item.pubDate);
      return date > cursor;
    });
    console.log(`Filtered to ${items.length} new items (skipped ${before - items.length} already processed)`);
  }

  if (items.length === 0) {
    console.log("No new items to process. Data is up to date.");
    return;
  }

  if (limit < items.length) {
    items = items.slice(0, limit);
    console.log(`Limited to first ${limit} items`);
  }

  // Split items into long (full-content) and short (description-only) groups
  const longItems = items.filter((i) => i.twitterRecap.length >= SHORT_CONTENT_THRESHOLD);
  const shortItems = items.filter((i) => i.twitterRecap.length < SHORT_CONTENT_THRESHOLD);

  console.log(`Processing ${longItems.length} full-content items individually, ${shortItems.length} short items in batches of ${BATCH_SIZE}`);

  const newEvents: ExtractedEvent[] = [];

  // Process long items individually
  for (let i = 0; i < longItems.length; i++) {
    const item = longItems[i];
    const date = parsePubDate(item.pubDate);
    console.log(
      `[${i + 1}/${longItems.length}] ${date} — ${item.title.slice(0, 60)}...`,
    );

    const events = await extractEventsFromItem(item);
    console.log(`  → ${events.length} events extracted`);
    newEvents.push(...events);
  }

  // Process short items in batches
  for (let i = 0; i < shortItems.length; i += BATCH_SIZE) {
    const batch = shortItems.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(shortItems.length / BATCH_SIZE);
    const dateRange = `${parsePubDate(batch[batch.length - 1].pubDate)} to ${parsePubDate(batch[0].pubDate)}`;
    console.log(
      `[batch ${batchNum}/${totalBatches}] ${batch.length} items (${dateRange})`,
    );

    const events = await extractEventsFromBatch(batch);
    console.log(`  → ${events.length} events extracted`);
    newEvents.push(...events);
  }

  // Merge with existing events and deduplicate
  const mergedEvents = deduplicateEvents([
    ...(existing?.events ?? []),
    ...newEvents,
  ]);

  // Sort by date ascending
  mergedEvents.sort((a, b) => a.date.localeCompare(b.date));

  const dates = mergedEvents.map((e) => e.date).sort();
  const today = new Date().toISOString().slice(0, 10);

  const output: TimelineFile = {
    version: 2,
    as_of: today,
    range_start: existing?.range_start ?? dates[0] ?? today,
    range_end: dates[dates.length - 1] ?? today,
    events: mergedEvents,
  };

  console.log(
    `\nResult: ${newEvents.length} new + ${existing?.events.length ?? 0} existing = ${mergedEvents.length} total (after dedup)`,
  );

  if (dryRun) {
    console.log("\n--- DRY RUN OUTPUT ---");
    console.log(JSON.stringify(output, null, 2));
  } else {
    fs.writeFileSync(
      OUTPUT_PATH,
      JSON.stringify(output, null, 2) + "\n",
      "utf-8",
    );
    console.log(`Wrote ${mergedEvents.length} events to ${OUTPUT_PATH}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
