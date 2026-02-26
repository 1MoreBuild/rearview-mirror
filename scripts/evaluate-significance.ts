/**
 * Re-evaluates event significance using full timeline context.
 *
 * Significance is inherently retrospective — a release's true impact often
 * takes weeks or months to become clear. This script sends batches of events
 * to an LLM that can compare them against each other and judge which ones
 * are genuine milestones vs. routine releases.
 *
 * Run this after extract-events.ts, or periodically to re-assess.
 *
 * Usage:
 *   OPENROUTER_API_KEY=sk-or-xxx npx tsx scripts/evaluate-significance.ts
 *
 * Options:
 *   --dry-run     Print result to stdout without writing file
 */

import fs from "node:fs";
import path from "node:path";

import { chatCompletion, getModelName } from "./shared/openrouter-client";

const DATA_PATH = path.resolve(__dirname, "../data/ai_timeline.json");
const BATCH_SIZE = 40; // Events per LLM call — enough context for relative comparison

type TimelineEvent = {
  date: string;
  date_precision: string;
  category: string;
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
  events: TimelineEvent[];
};

const SYSTEM_PROMPT = fs.readFileSync(
  path.resolve(__dirname, "shared/significance-prompt.txt"),
  "utf-8",
);

async function evaluateBatch(
  events: TimelineEvent[],
): Promise<("high" | "low")[]> {
  const listing = events
    .map(
      (e, i) =>
        `[${i}] ${e.date} | ${e.category} | ${e.organization} | ${e.title}\n    ${e.summary}`,
    )
    .join("\n");

  const userPrompt = `Evaluate these ${events.length} events:\n\n${listing}`;

  const response = await chatCompletion(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    { temperature: 0.1, maxTokens: 4096 },
  );

  try {
    const cleaned = response
      .replace(/^```json?\s*/m, "")
      .replace(/```\s*$/m, "")
      .trim();
    const parsed = JSON.parse(cleaned) as { index: number; significance: string }[];
    if (!Array.isArray(parsed)) return events.map(() => "low");

    const result: ("high" | "low")[] = events.map(() => "low");
    for (const item of parsed) {
      if (item.index >= 0 && item.index < events.length) {
        result[item.index] = item.significance === "high" ? "high" : "low";
      }
    }
    return result;
  } catch {
    console.error("  Failed to parse significance response");
    return events.map(() => "low");
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  console.log(`Model: ${getModelName()}`);

  const data: TimelineFile = JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));
  console.log(`Loaded ${data.events.length} events (${data.range_start} to ${data.range_end})`);

  // Process in chronological batches so LLM can compare within time periods
  const events = [...data.events].sort((a, b) => a.date.localeCompare(b.date));
  const totalBatches = Math.ceil(events.length / BATCH_SIZE);

  let highCount = 0;

  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const batch = events.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const dateRange = `${batch[0].date} to ${batch[batch.length - 1].date}`;
    console.log(`[batch ${batchNum}/${totalBatches}] ${batch.length} events (${dateRange})`);

    const significances = await evaluateBatch(batch);
    const batchHigh = significances.filter((s) => s === "high").length;
    highCount += batchHigh;

    for (let j = 0; j < batch.length; j++) {
      batch[j].significance = significances[j];
      if (significances[j] === "high") {
        console.log(`  ★ ${batch[j].date} ${batch[j].title}`);
      }
    }
    console.log(`  → ${batchHigh} high, ${batch.length - batchHigh} low`);
  }

  // Write back sorted events
  data.events = events;

  const ratio = ((highCount / events.length) * 100).toFixed(1);
  console.log(`\nResult: ${highCount}/${events.length} high (${ratio}%)`);

  if (dryRun) {
    console.log("\n--- DRY RUN — not writing ---");
    // Print just the high events
    for (const e of events) {
      if (e.significance === "high") {
        console.log(`  ${e.date} [${e.category}] ${e.title}`);
      }
    }
  } else {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + "\n", "utf-8");
    console.log(`Wrote to ${DATA_PATH}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
