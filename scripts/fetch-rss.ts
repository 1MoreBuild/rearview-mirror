import { fetchNewRssItems } from "./shared/rss-parser.js";
import { extractEventsFromNewsletter } from "./extract-events.js";
import { deduplicateEvents } from "./shared/dedup.js";
import {
  findCurrentDataFile,
  readDataFile,
  getAllExistingEvents,
} from "./shared/data-file-utils.js";
import { createCandidateIssue } from "./create-issue.js";
import type { OpenRouterConfig } from "./shared/openrouter-client.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function main(): Promise<void> {
  const feedUrl = requireEnv("RSS_FEED_URL");
  const apiKey = requireEnv("OPENROUTER_API_KEY");
  const model = process.env.OPENROUTER_MODEL ?? "minimax/minimax-m2.5";

  // 1. Load current timeline data
  const dataFile = findCurrentDataFile("data/");
  const currentData = readDataFile(dataFile);
  const lastProcessedDate = currentData.as_of;

  console.log(`Current data file: ${dataFile}`);
  console.log(`Last processed date: ${lastProcessedDate}`);
  console.log(`RSS feed: ${feedUrl}`);
  console.log(`Model: ${model}`);

  // 2. Fetch new RSS items since last processed date
  console.log(`\nFetching RSS items after ${lastProcessedDate}...`);
  const newItems = await fetchNewRssItems(feedUrl, lastProcessedDate);

  if (newItems.length === 0) {
    console.log("No new newsletter items found. Exiting.");
    return;
  }

  console.log(`Found ${newItems.length} new newsletter item(s)`);

  const config: OpenRouterConfig = {
    apiKey,
    model,
    siteName: "rearview-mirror",
  };

  // 3. Process each new newsletter item
  for (const item of newItems) {
    console.log(`\nProcessing: "${item.title}" (${item.pubDate})`);

    // 3a. Extract events via LLM
    const result = await extractEventsFromNewsletter(
      item.contentHtml,
      item.pubDate,
      config,
      currentData,
    );

    console.log(
      `  Extracted ${result.events.length} event(s), skipped ${result.skippedCount} invalid`,
    );

    if (result.events.length === 0) {
      console.log("  No events extracted. Skipping.");
      continue;
    }

    // 3b. Deduplicate against existing data
    const allExisting = getAllExistingEvents(currentData);
    const uniqueEvents = deduplicateEvents(result.events, allExisting);

    console.log(
      `  After dedup: ${uniqueEvents.length} new event(s) (${result.events.length - uniqueEvents.length} duplicates removed)`,
    );

    if (uniqueEvents.length === 0) {
      console.log("  All events already exist. Skipping.");
      continue;
    }

    // 3c. Create GitHub Issue
    const issue = createCandidateIssue(
      uniqueEvents,
      item.pubDate,
      item.title,
      item.link,
    );

    console.log(`  Created issue #${issue.issueNumber}: ${issue.issueUrl}`);
  }

  console.log("\nDone.");
}

main().catch((error) => {
  console.error("Pipeline failed:", error);
  process.exit(1);
});
