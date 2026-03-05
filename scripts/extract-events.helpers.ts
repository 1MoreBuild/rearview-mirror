import fs from "node:fs";
import path from "node:path";

export type RssItem = {
  title: string;
  pubDate: string;
  link: string;
  twitterRecap: string;
};

export type ParsedRssItem = RssItem & { contentType: "full" | "description" };

export type ExtractedEvent = {
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

export type TimelineFile = {
  version: number;
  as_of: string;
  range_start: string;
  range_end: string;
  events: ExtractedEvent[];
};

export type AuditRssItem = {
  rssTitle: string;
  pubDate: string;
  link: string;
  contentLength: number;
  contentType: "full" | "description";
  processingMode: "individual" | "batch";
  batchIndex?: number;
  eventsExtracted: {
    date: string;
    title: string;
    organization: string;
    category: string;
  }[];
};

export type AuditDedup = {
  kept: { date: string; title: string; organization: string };
  dropped: { date: string; title: string; organization: string };
  reason: string;
};

export type AuditExtractionLog = {
  timestamp: string;
  model: string;
  config: {
    mode: "full" | "incremental";
    dryRun: boolean;
    limit: number | null;
    rssSource: string;
    batchSize: number;
    shortContentThreshold: number;
  };
  input: {
    totalRssItems: number;
    filteredRssItems: number;
    longItems: number;
    shortItems: number;
    batches: number;
  };
  items: AuditRssItem[];
  dedup: {
    beforeCount: number;
    afterCount: number;
    removedCount: number;
    details: AuditDedup[];
  };
  result: {
    newEvents: number;
    existingEvents: number;
    totalAfterMerge: number;
    dateRange: string;
  };
};

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

export function parseRssItems(xml: string): ParsedRssItem[] {
  const items: ParsedRssItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;

  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];

    const title = block.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() ?? "";
    const pubDate =
      block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() ?? "";
    const link = block.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() ?? "";

    const encoded =
      block.match(
        /<content:encoded>([\s\S]*?)<\/content:encoded>/,
      )?.[1] ?? "";

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
        items.push({ title, pubDate, link, twitterRecap, contentType: "full" });
        continue;
      }
    }

    const description =
      block.match(/<description>([\s\S]*?)<\/description>/)?.[1]?.trim() ?? "";
    if (description) {
      const descText = stripHtml(description);
      if (descText.length >= 80) {
        items.push({
          title,
          pubDate,
          link,
          twitterRecap: descText,
          contentType: "description",
        });
      }
    }
  }

  return items;
}

export function parsePubDate(pubDate: string): string {
  const d = new Date(pubDate);
  if (isNaN(d.getTime())) return "";
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function maxDate(values: string[]): string {
  return values
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
    .sort()
    .at(-1) ?? "";
}

export function clampDateToMax(date: string, maxDateInclusive: string): string {
  if (!date) return "";
  return date > maxDateInclusive ? maxDateInclusive : date;
}

export function loadExistingTimeline(outputPath: string): TimelineFile | null {
  if (!fs.existsSync(outputPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(outputPath, "utf-8"));
  } catch {
    return null;
  }
}

function extractKeyTerms(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/(\d)\.(\d)/g, "$1$2")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/([a-z])(\s+)(\d)/g, "$1$3")
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .filter(
      (w) =>
        ![
          "the",
          "with",
          "for",
          "via",
          "and",
          "new",
          "from",
          "released",
          "launches",
          "ships",
          "announces",
          "introduces",
          "model",
          "open",
          "source",
          "weight",
          "series",
          "medium",
          "architecture",
          "long",
          "context",
          "moe",
          "fp8",
          "weights",
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
  if (overlap >= 0.8) return true;

  const orgA = a.organization.toLowerCase();
  const orgB = b.organization.toLowerCase();
  const sameOrg = orgA.includes(orgB) || orgB.includes(orgA);
  return sameOrg && overlap >= 0.5;
}

export function deduplicateEvents(
  events: ExtractedEvent[],
): { result: ExtractedEvent[]; details: AuditDedup[] } {
  const result: ExtractedEvent[] = [];
  const details: AuditDedup[] = [];

  for (const event of events) {
    const dupIndex = result.findIndex((existing) =>
      eventsOverlap(existing, event),
    );

    if (dupIndex !== -1) {
      const existing = result[dupIndex];
      if (
        event.significance === "high" && existing.significance !== "high"
      ) {
        details.push({
          kept: {
            date: event.date,
            title: event.title,
            organization: event.organization,
          },
          dropped: {
            date: existing.date,
            title: existing.title,
            organization: existing.organization,
          },
          reason: `new has higher significance; title overlap with "${existing.title}"`,
        });
        result[dupIndex] = event;
      } else if (
        event.significance === existing.significance &&
        event.date < existing.date
      ) {
        details.push({
          kept: {
            date: event.date,
            title: event.title,
            organization: event.organization,
          },
          dropped: {
            date: existing.date,
            title: existing.title,
            organization: existing.organization,
          },
          reason: `same significance, new has earlier date; title overlap with "${existing.title}"`,
        });
        result[dupIndex] = event;
      } else {
        details.push({
          kept: {
            date: existing.date,
            title: existing.title,
            organization: existing.organization,
          },
          dropped: {
            date: event.date,
            title: event.title,
            organization: event.organization,
          },
          reason: `duplicate of "${existing.title}"`,
        });
      }
      continue;
    }
    result.push(event);
  }

  return { result, details };
}

export function writeAuditLog(log: AuditExtractionLog, logsDir: string): string {
  fs.mkdirSync(logsDir, { recursive: true });
  const filename = `extract-${log.timestamp.replace(/[:.]/g, "-")}.json`;
  const filepath = path.join(logsDir, filename);
  fs.writeFileSync(filepath, JSON.stringify(log, null, 2) + "\n", "utf-8");
  return filepath;
}
