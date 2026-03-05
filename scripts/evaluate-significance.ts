/**
 * Re-evaluates event significance using LLM + community signal validation.
 *
 * Two-pass approach:
 *   1. LLM nominates candidate "high" events based on context
 *   2. Hacker News + Wikipedia validate each candidate —
 *      only events with real community buzz survive as "high"
 *
 * Every run produces an audit log in data/logs/ with full decision details.
 *
 * Usage:
 *   OPENROUTER_API_KEY=sk-or-xxx pnpm exec tsx scripts/evaluate-significance.ts
 *
 * Options:
 *   --dry-run           Print result without writing file
 *   --skip-validation   Skip HN/Wikipedia validation (LLM only)
 */

import fs from "node:fs";
import path from "node:path";

import {
  checkHackerNews,
  checkWikipediaPageviews,
  extractSearchKeyword,
  findWikipediaArticle,
  sleep,
  type AuditLog,
  type TimelineEvent,
  type TimelineFile,
  writeAuditLog,
} from "./evaluate-significance.helpers";
import { chatCompletion, getModelName } from "./shared/openrouter-client";

const DATA_PATH = path.resolve(__dirname, "../data/ai_timeline.json");
const LOGS_DIR = path.resolve(__dirname, "../data/logs");
const LLM_BATCH_SIZE = 40;

const HN_POINTS_THRESHOLD = 200;
const WIKI_VIEWS_THRESHOLD = 5000;

const SYSTEM_PROMPT = fs.readFileSync(
  path.resolve(__dirname, "shared/significance-prompt.txt"),
  "utf-8",
);

const LLM_MAX_RETRIES = 3;

async function llmNominateBatch(
  events: TimelineEvent[],
): Promise<{ results: ("high" | "low")[]; retries: number }> {
  const listing = events
    .map(
      (e, i) =>
        `[${i}] ${e.date} | ${e.category} | ${e.organization} | ${e.title}\n    ${e.summary}`,
    )
    .join("\n");

  const userPrompt = `Evaluate these ${events.length} events:\n\n${listing}`;

  let retries = 0;
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
      if (!Array.isArray(parsed)) {
        throw new Error("Response is not an array");
      }

      const result: ("high" | "low")[] = events.map(() => "low");
      for (const item of parsed) {
        if (item.index >= 0 && item.index < events.length) {
          result[item.index] = item.significance === "high" ? "high" : "low";
        }
      }
      return { results: result, retries };
    } catch {
      retries++;
      if (attempt < LLM_MAX_RETRIES - 1) {
        console.error(
          `  ⟳ LLM parse failed, retry ${attempt + 1}/${LLM_MAX_RETRIES}...`,
        );
      } else {
        console.error(`  ✗ LLM parse failed after ${LLM_MAX_RETRIES} attempts`);
      }
    }
  }

  return { results: events.map(() => "low"), retries };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const skipValidation = args.includes("--skip-validation");

  const runTimestamp = new Date().toISOString();

  console.log(`Model: ${getModelName()}`);
  if (!skipValidation) {
    console.log(
      `Validation: HN (>=${HN_POINTS_THRESHOLD} pts) + Wikipedia (>=${WIKI_VIEWS_THRESHOLD} views/day)`,
    );
  }

  const data: TimelineFile = JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));
  console.log(
    `Loaded ${data.events.length} events (${data.range_start} to ${data.range_end})`,
  );

  const events = [...data.events].sort((a, b) => a.date.localeCompare(b.date));

  const audit: AuditLog = {
    timestamp: runTimestamp,
    model: getModelName(),
    config: {
      llmBatchSize: LLM_BATCH_SIZE,
      hnThreshold: HN_POINTS_THRESHOLD,
      wikiThreshold: WIKI_VIEWS_THRESHOLD,
      skipValidation,
      dryRun,
    },
    input: {
      totalEvents: events.length,
      dateRange: `${data.range_start} to ${data.range_end}`,
    },
    pass1_llm: {
      batches: [],
      totalNominated: 0,
    },
    pass2_validation: [],
    result: {
      highCount: 0,
      totalCount: events.length,
      highRatio: "0.0%",
      highEvents: [],
    },
  };

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

    const { results: significances, retries } = await llmNominateBatch(batch);
    let batchHigh = 0;
    const nominated: string[] = [];

    for (let j = 0; j < batch.length; j++) {
      if (significances[j] === "high") {
        candidates.push(batch[j]);
        batchHigh++;
        nominated.push(batch[j].title);
        console.log(`  ☆ ${batch[j].date} ${batch[j].title}`);
      }
      batch[j].significance = "low";
    }

    console.log(`  → ${batchHigh} candidates, ${batch.length - batchHigh} low`);

    audit.pass1_llm.batches.push({
      batch: batchNum,
      dateRange,
      eventCount: batch.length,
      nominated,
      retries,
    });
  }

  audit.pass1_llm.totalNominated = candidates.length;
  console.log(`\nLLM nominated ${candidates.length} candidates`);

  let finalHigh: TimelineEvent[];

  if (skipValidation) {
    console.log("\n═══ Pass 2: SKIPPED (--skip-validation) ═══");
    finalHigh = candidates;

    for (const event of candidates) {
      audit.pass2_validation.push({
        date: event.date,
        title: event.title,
        organization: event.organization,
        keyword: extractSearchKeyword(event),
        hn: { topPoints: 0, topComments: 0, totalStories: 0, pass: false },
        wiki: { article: null, peakViews: 0, avgViews: 0, pass: false },
        result: "high",
        reason: "skip-validation: LLM nomination accepted without external check",
      });
    }
  } else {
    console.log("\n═══ Pass 2: HN + Wikipedia validation ═══");
    finalHigh = [];

    for (const event of candidates) {
      const keyword = extractSearchKeyword(event);

      const [hn, wikiArticle] = await Promise.all([
        checkHackerNews(keyword, event.date),
        findWikipediaArticle(keyword),
      ]);

      let wiki = { peakViews: 0, avgViews: 0 };
      if (wikiArticle) {
        wiki = await checkWikipediaPageviews(wikiArticle, event.date);
      }

      const hnPass = hn.topPoints >= HN_POINTS_THRESHOLD;
      const wikiPass = wiki.peakViews >= WIKI_VIEWS_THRESHOLD;
      const pass = hnPass || wikiPass;

      const hnStr = `HN:${hn.topPoints}pts`;
      const wikiStr = wikiArticle ? `Wiki:${wiki.peakViews}views` : "Wiki:N/A";

      let reason: string;
      if (hnPass && wikiPass) {
        reason = `PASS both: HN ${hn.topPoints}>=${HN_POINTS_THRESHOLD}pts AND Wiki ${wiki.peakViews}>=${WIKI_VIEWS_THRESHOLD}views`;
      } else if (hnPass) {
        reason = `PASS HN: ${hn.topPoints}>=${HN_POINTS_THRESHOLD}pts`;
      } else if (wikiPass) {
        reason = `PASS Wiki: ${wiki.peakViews}>=${WIKI_VIEWS_THRESHOLD}views`;
      } else {
        const parts: string[] = [];
        parts.push(`HN ${hn.topPoints}<${HN_POINTS_THRESHOLD}pts`);
        if (wikiArticle) {
          parts.push(`Wiki ${wiki.peakViews}<${WIKI_VIEWS_THRESHOLD}views`);
        } else {
          parts.push("Wiki: no article found");
        }
        reason = `FAIL: ${parts.join(", ")}`;
      }

      audit.pass2_validation.push({
        date: event.date,
        title: event.title,
        organization: event.organization,
        keyword,
        hn: {
          topPoints: hn.topPoints,
          topComments: hn.topComments,
          totalStories: hn.totalStories,
          pass: hnPass,
        },
        wiki: {
          article: wikiArticle,
          peakViews: wiki.peakViews,
          avgViews: wiki.avgViews,
          pass: wikiPass,
        },
        result: pass ? "high" : "low",
        reason,
      });

      if (pass) {
        console.log(`  ★ PASS  ${event.date} "${keyword}" ${hnStr} ${wikiStr}`);
        finalHigh.push(event);
      } else {
        console.log(`  ✗ FAIL  ${event.date} "${keyword}" ${hnStr} ${wikiStr}`);
      }

      await sleep(200);
    }
  }

  const highIds = new Set(finalHigh.map((e) => `${e.date}|${e.title}`));
  for (const event of events) {
    event.significance = highIds.has(`${event.date}|${event.title}`)
      ? "high"
      : "low";
  }

  data.events = events;

  const highRatio = ((finalHigh.length / events.length) * 100).toFixed(1);
  console.log(`\nFinal: ${finalHigh.length}/${events.length} high (${highRatio}%)`);

  audit.result = {
    highCount: finalHigh.length,
    totalCount: events.length,
    highRatio: `${highRatio}%`,
    highEvents: finalHigh.map((e) => ({
      date: e.date,
      title: e.title,
      organization: e.organization,
    })),
  };

  if (dryRun) {
    console.log("\n--- DRY RUN — not writing ---");
    for (const e of finalHigh) {
      console.log(`  ${e.date} [${e.category}] ${e.title}`);
    }
  } else {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + "\n", "utf-8");
    console.log(`Wrote to ${DATA_PATH}`);
  }

  const logPath = writeAuditLog(audit, LOGS_DIR);
  console.log(`Audit log: ${logPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
