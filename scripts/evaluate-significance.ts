/**
 * Re-evaluates event significance using LLM + Google Trends validation.
 *
 * Two-pass approach:
 *   1. LLM nominates candidate "high" events based on context
 *   2. Google Trends validates each candidate against a reference keyword —
 *      only events with real search interest spikes survive as "high"
 *
 * This ensures significance is grounded in real-world community reaction,
 * not just LLM judgment.
 *
 * Usage:
 *   OPENROUTER_API_KEY=sk-or-xxx npx tsx scripts/evaluate-significance.ts
 *
 * Options:
 *   --dry-run         Print result without writing file
 *   --skip-trends     Skip Google Trends validation (LLM only)
 */

import fs from "node:fs";
import path from "node:path";

// @ts-expect-error — no types for google-trends-api
import googleTrends from "google-trends-api";

import { chatCompletion, getModelName } from "./shared/openrouter-client";

const DATA_PATH = path.resolve(__dirname, "../data/ai_timeline.json");
const LLM_BATCH_SIZE = 40;
const TRENDS_REFERENCE = "Hugging Face"; // Stable AI-community reference
const TRENDS_THRESHOLD = 20; // ratio% vs reference — must exceed to be "high"

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

// ─── Pass 1: LLM nomination ────────────────────────────────────────────────

const LLM_MAX_RETRIES = 3;

async function llmNominateBatch(
  events: TimelineEvent[],
): Promise<("high" | "low")[]> {
  const listing = events
    .map(
      (e, i) =>
        `[${i}] ${e.date} | ${e.category} | ${e.organization} | ${e.title}\n    ${e.summary}`,
    )
    .join("\n");

  const userPrompt = `Evaluate these ${events.length} events:\n\n${listing}`;

  for (let attempt = 0; attempt < LLM_MAX_RETRIES; attempt++) {
    const response = await chatCompletion(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      { temperature: 0, maxTokens: 4096 },
    );

    try {
      const cleaned = response
        .replace(/^```json?\s*/m, "")
        .replace(/```\s*$/m, "")
        .trim();
      const parsed = JSON.parse(cleaned) as {
        index: number;
        significance: string;
      }[];
      if (!Array.isArray(parsed)) throw new Error("Response is not an array");

      const result: ("high" | "low")[] = events.map(() => "low");
      for (const item of parsed) {
        if (item.index >= 0 && item.index < events.length) {
          result[item.index] = item.significance === "high" ? "high" : "low";
        }
      }
      return result;
    } catch {
      if (attempt < LLM_MAX_RETRIES - 1) {
        console.error(
          `  ⟳ LLM parse failed, retry ${attempt + 1}/${LLM_MAX_RETRIES}...`,
        );
      } else {
        console.error(
          `  ✗ LLM parse failed after ${LLM_MAX_RETRIES} attempts`,
        );
      }
    }
  }
  return events.map(() => "low");
}

// ─── Pass 2: Google Trends validation ───────────────────────────────────────

function extractSearchKeyword(event: TimelineEvent): string {
  const title = event.title;

  // Strip leading org/company + verb phrases:
  // "OpenAI launches GPT-4o ..." → "GPT-4o"
  // "Meta releases Llama 3.1 ..." → "Llama 3.1"
  // "Google's Gemini AI model announced" → "Gemini AI model"
  const afterOrgVerb = title.match(
    /^(?:\w+(?:\s+\w+)?\s+)?(?:launches?|releases?|unveils?|introduces?|announces?|ships?)\s+(.+)/i,
  );

  let subject = afterOrgVerb ? afterOrgVerb[1] : title;

  // Strip trailing verb phrases:
  // "GPT-4o multimodal model" → "GPT-4o"
  // "Llama 3.1 including 405B parameter model" → "Llama 3.1"
  subject = subject
    .replace(
      /\s+(?:released|launched|announced|unveiled|introduced|with|featuring|including|achieving|reaches|open-source|open source).*$/i,
      "",
    )
    .trim();

  // Strip generic nouns: "model", "family", "system", "parameters"
  subject = subject
    .replace(
      /\s+(?:model|family|system|variant|variants|parameters?|preview)\b.*$/i,
      "",
    )
    .trim();

  // Possessives: "Google's" → ""
  subject = subject.replace(/^\w+'s\s+/i, "").trim();

  // Keep it short for Google Trends (long phrases return 0)
  if (subject.length > 30) subject = subject.slice(0, 30).trim();

  return subject || title.slice(0, 25).trim();
}

const TRENDS_MAX_RETRIES = 3;
const TRENDS_BASE_DELAY = 2000; // ms between requests

async function checkGoogleTrends(
  keyword: string,
  date: string,
): Promise<{ peak: number; refPeak: number; ratio: number }> {
  const eventDate = new Date(date);
  const start = new Date(eventDate);
  start.setDate(start.getDate() - 14);
  const end = new Date(eventDate);
  end.setDate(end.getDate() + 14);

  for (let attempt = 0; attempt < TRENDS_MAX_RETRIES; attempt++) {
    try {
      const res = await googleTrends.interestOverTime({
        keyword: [keyword, TRENDS_REFERENCE],
        startTime: start,
        endTime: end,
        geo: "",
      });

      // Detect HTML response (rate limit / CAPTCHA)
      if (typeof res === "string" && res.trimStart().startsWith("<")) {
        throw new Error("Google Trends returned HTML (rate limited)");
      }

      const data = JSON.parse(res);
      const points = data.default.timelineData;

      let peak = 0;
      let refPeak = 0;
      for (const p of points) {
        peak = Math.max(peak, p.value[0]);
        refPeak = Math.max(refPeak, p.value[1]);
      }
      const ratio = refPeak > 0 ? (peak / refPeak) * 100 : 0;
      return { peak, refPeak, ratio };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < TRENDS_MAX_RETRIES - 1) {
        const backoff = TRENDS_BASE_DELAY * 2 ** attempt;
        console.error(
          `    ⟳ retry ${attempt + 1}/${TRENDS_MAX_RETRIES} in ${backoff}ms: ${msg}`,
        );
        await sleep(backoff);
      } else {
        console.error(`    ✗ failed after ${TRENDS_MAX_RETRIES} attempts: ${msg}`);
      }
    }
  }
  return { peak: 0, refPeak: 0, ratio: 0 };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const skipTrends = args.includes("--skip-trends");

  console.log(`Model: ${getModelName()}`);
  if (!skipTrends) {
    console.log(
      `Trends validation: ON (ref="${TRENDS_REFERENCE}", threshold=${TRENDS_THRESHOLD}%)`,
    );
  }

  const data: TimelineFile = JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));
  console.log(
    `Loaded ${data.events.length} events (${data.range_start} to ${data.range_end})`,
  );

  const events = [...data.events].sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  // ── Pass 1: LLM nomination ──
  console.log("\n═══ Pass 1: LLM nomination ═══");
  const totalBatches = Math.ceil(events.length / LLM_BATCH_SIZE);
  const candidates: TimelineEvent[] = [];

  for (let i = 0; i < events.length; i += LLM_BATCH_SIZE) {
    const batch = events.slice(i, i + LLM_BATCH_SIZE);
    const batchNum = Math.floor(i / LLM_BATCH_SIZE) + 1;
    const dateRange = `${batch[0].date} to ${batch[batch.length - 1].date}`;
    console.log(
      `[batch ${batchNum}/${totalBatches}] ${batch.length} events (${dateRange})`,
    );

    const significances = await llmNominateBatch(batch);
    let batchHigh = 0;

    for (let j = 0; j < batch.length; j++) {
      if (significances[j] === "high") {
        candidates.push(batch[j]);
        batchHigh++;
        console.log(`  ☆ ${batch[j].date} ${batch[j].title}`);
      }
      batch[j].significance = "low"; // Reset all to low; pass 2 promotes
    }
    console.log(
      `  → ${batchHigh} candidates, ${batch.length - batchHigh} low`,
    );
  }

  console.log(`\nLLM nominated ${candidates.length} candidates`);

  // ── Pass 2: Google Trends validation ──
  let finalHigh: TimelineEvent[];

  if (skipTrends) {
    console.log("\n═══ Pass 2: SKIPPED (--skip-trends) ═══");
    finalHigh = candidates;
  } else {
    console.log("\n═══ Pass 2: Google Trends validation ═══");
    finalHigh = [];

    for (const event of candidates) {
      const keyword = extractSearchKeyword(event);
      const { peak, refPeak, ratio } = await checkGoogleTrends(
        keyword,
        event.date,
      );
      const ratioStr = ratio.toFixed(1);
      const pass = ratio >= TRENDS_THRESHOLD;

      if (pass) {
        console.log(
          `  ★ PASS  ${event.date} "${keyword}" peak:${peak} ref:${refPeak} ratio:${ratioStr}%`,
        );
        finalHigh.push(event);
      } else {
        console.log(
          `  ✗ FAIL  ${event.date} "${keyword}" peak:${peak} ref:${refPeak} ratio:${ratioStr}%`,
        );
      }

      // Rate limit: Google Trends can throttle
      await sleep(TRENDS_BASE_DELAY);
    }
  }

  // Apply final significance
  const highIds = new Set(finalHigh.map((e) => `${e.date}|${e.title}`));
  for (const event of events) {
    event.significance = highIds.has(`${event.date}|${event.title}`)
      ? "high"
      : "low";
  }

  data.events = events;

  const ratio = ((finalHigh.length / events.length) * 100).toFixed(1);
  console.log(
    `\nFinal: ${finalHigh.length}/${events.length} high (${ratio}%)`,
  );

  if (dryRun) {
    console.log("\n--- DRY RUN — not writing ---");
    for (const e of finalHigh) {
      console.log(`  ${e.date} [${e.category}] ${e.title}`);
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
