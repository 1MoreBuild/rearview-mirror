/**
 * Re-evaluates event significance using LLM + community signal validation.
 *
 * Two-pass approach:
 *   1. LLM nominates candidate "high" events based on context
 *   2. Hacker News + Wikipedia validate each candidate —
 *      only events with real community buzz survive as "high"
 *
 * This ensures significance is grounded in real-world community reaction,
 * not just LLM judgment.
 *
 * Usage:
 *   OPENROUTER_API_KEY=sk-or-xxx npx tsx scripts/evaluate-significance.ts
 *
 * Options:
 *   --dry-run           Print result without writing file
 *   --skip-validation   Skip HN/Wikipedia validation (LLM only)
 */

import fs from "node:fs";
import path from "node:path";

import { chatCompletion, getModelName } from "./shared/openrouter-client";

const DATA_PATH = path.resolve(__dirname, "../data/ai_timeline.json");
const LLM_BATCH_SIZE = 40;

// ─── Validation thresholds ──────────────────────────────────────────────────
const HN_POINTS_THRESHOLD = 200; // top story must have >= this many points
const WIKI_VIEWS_THRESHOLD = 5000; // peak daily pageviews must exceed this

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

// ─── Pass 2: Community signal validation ─────────────────────────────────────

function extractSearchKeyword(event: TimelineEvent): string {
  const title = event.title;

  // Strip leading org/company + verb phrases:
  // "OpenAI launches GPT-4o ..." → "GPT-4o"
  // "Meta releases Llama 3.1 ..." → "Llama 3.1"
  // "Cognition Labs releases Devin AI ..." → "Devin AI"
  const afterOrgVerb = title.match(
    /^(?:[\w-]+(?:\s+[\w-]+){0,2}?\s+)?(?:launches?|releases?|unveils?|introduces?|announces?|ships?|showcases?|previews?)\s+(.+)/i,
  );

  let subject = afterOrgVerb ? afterOrgVerb[1] : title;

  // Strip trailing verb phrases
  subject = subject
    .replace(
      /\s+(?:released|launched|announced|unveiled|introduced|with|featuring|including|achieving|reaches|open-source|open source|as\s).*$/i,
      "",
    )
    .trim();

  // Strip descriptive adjectives and generic nouns
  subject = subject
    .replace(
      /\s+(?:multimodal|hybrid|reasoning|open-weight|agentic|autonomous|non-generative|vision-language)\b/gi,
      "",
    )
    .trim();
  subject = subject
    .replace(
      /\s+(?:model|family|system|variant|variants|parameters?|preview|capabilities|details)\b.*$/i,
      "",
    )
    .trim();

  // Possessives: "Google's" → ""
  subject = subject.replace(/^\w+'s\s+/i, "").trim();

  // Strip "full version of" prefix
  subject = subject.replace(/^full\s+version\s+of\s+/i, "").trim();

  if (subject.length > 30) subject = subject.slice(0, 30).trim();

  return subject || title.slice(0, 25).trim();
}

// ─── Hacker News Algolia API ─────────────────────────────────────────────────

interface HNSearchResult {
  nbHits: number;
  hits: {
    title: string;
    points: number | null;
    num_comments: number | null;
    created_at: string;
    objectID: string;
  }[];
}

async function checkHackerNews(
  keyword: string,
  date: string,
): Promise<{ topPoints: number; topComments: number; totalStories: number }> {
  const eventDate = new Date(date);
  const start = new Date(eventDate);
  start.setDate(start.getDate() - 7);
  const end = new Date(eventDate);
  end.setDate(end.getDate() + 14);

  const startUnix = Math.floor(start.getTime() / 1000);
  const endUnix = Math.floor(end.getTime() / 1000);

  const params = new URLSearchParams({
    query: keyword,
    tags: "story",
    numericFilters: `created_at_i>${startUnix},created_at_i<${endUnix}`,
    hitsPerPage: "5",
  });

  try {
    const res = await fetch(
      `https://hn.algolia.com/api/v1/search?${params}`,
    );
    if (!res.ok) return { topPoints: 0, topComments: 0, totalStories: 0 };

    const data: HNSearchResult = await res.json();
    const topHit = data.hits[0];

    return {
      topPoints: topHit?.points ?? 0,
      topComments: topHit?.num_comments ?? 0,
      totalStories: data.nbHits,
    };
  } catch {
    return { topPoints: 0, topComments: 0, totalStories: 0 };
  }
}

// ─── Wikipedia Pageviews API ─────────────────────────────────────────────────

async function findWikipediaArticle(
  keyword: string,
): Promise<string | null> {
  try {
    const params = new URLSearchParams({
      action: "opensearch",
      search: keyword,
      limit: "1",
      format: "json",
    });
    const res = await fetch(
      `https://en.wikipedia.org/w/api.php?${params}`,
    );
    if (!res.ok) return null;

    const data = (await res.json()) as [string, string[]];
    return data[1]?.[0] ?? null;
  } catch {
    return null;
  }
}

async function checkWikipediaPageviews(
  articleTitle: string,
  date: string,
): Promise<{ peakViews: number; avgViews: number }> {
  const eventDate = new Date(date);
  const start = new Date(eventDate);
  start.setDate(start.getDate() - 7);
  const end = new Date(eventDate);
  end.setDate(end.getDate() + 14);

  const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
  const encoded = encodeURIComponent(articleTitle.replace(/ /g, "_"));
  const url =
    `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article` +
    `/en.wikipedia/all-access/user/${encoded}/daily/${fmt(start)}/${fmt(end)}`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "rearview-mirror/1.0 (AI timeline project)",
      },
    });
    if (!res.ok) return { peakViews: 0, avgViews: 0 };

    const data = (await res.json()) as {
      items?: { views: number }[];
    };
    const views = (data.items ?? []).map((i) => i.views);
    const peak = Math.max(...views, 0);
    const avg =
      views.length > 0
        ? Math.round(views.reduce((a, b) => a + b, 0) / views.length)
        : 0;
    return { peakViews: peak, avgViews: avg };
  } catch {
    return { peakViews: 0, avgViews: 0 };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const skipValidation = args.includes("--skip-validation");

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

  // ── Pass 2: Community signal validation ──
  let finalHigh: TimelineEvent[];

  if (skipValidation) {
    console.log("\n═══ Pass 2: SKIPPED (--skip-validation) ═══");
    finalHigh = candidates;
  } else {
    console.log("\n═══ Pass 2: HN + Wikipedia validation ═══");
    finalHigh = [];

    for (const event of candidates) {
      const keyword = extractSearchKeyword(event);

      // Query HN and Wikipedia in parallel
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
      const wikiStr = wikiArticle
        ? `Wiki:${wiki.peakViews}views`
        : "Wiki:N/A";

      if (pass) {
        console.log(
          `  ★ PASS  ${event.date} "${keyword}" ${hnStr} ${wikiStr}`,
        );
        finalHigh.push(event);
      } else {
        console.log(
          `  ✗ FAIL  ${event.date} "${keyword}" ${hnStr} ${wikiStr}`,
        );
      }

      // Small delay to be polite to Wikipedia API
      await sleep(200);
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
