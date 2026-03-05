import fs from "node:fs";
import path from "node:path";

export type TimelineEvent = {
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

export type TimelineFile = {
  version: number;
  as_of: string;
  range_start: string;
  range_end: string;
  events: TimelineEvent[];
};

export type AuditLLMBatch = {
  batch: number;
  dateRange: string;
  eventCount: number;
  nominated: string[];
  retries: number;
};

export type AuditValidation = {
  date: string;
  title: string;
  organization: string;
  keyword: string;
  hn: {
    topPoints: number;
    topComments: number;
    totalStories: number;
    pass: boolean;
  };
  wiki: {
    article: string | null;
    peakViews: number;
    avgViews: number;
    pass: boolean;
  };
  result: "high" | "low";
  reason: string;
};

export type AuditLog = {
  timestamp: string;
  model: string;
  config: {
    llmBatchSize: number;
    hnThreshold: number;
    wikiThreshold: number;
    skipValidation: boolean;
    dryRun: boolean;
  };
  input: {
    totalEvents: number;
    dateRange: string;
  };
  pass1_llm: {
    batches: AuditLLMBatch[];
    totalNominated: number;
  };
  pass2_validation: AuditValidation[];
  result: {
    highCount: number;
    totalCount: number;
    highRatio: string;
    highEvents: { date: string; title: string; organization: string }[];
  };
};

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

export function extractSearchKeyword(event: TimelineEvent): string {
  const title = event.title;

  const afterOrgVerb = title.match(
    /^(?:[\w-]+(?:\s+[\w-]+){0,2}?\s+)?(?:launches?|releases?|unveils?|introduces?|announces?|ships?|showcases?|previews?)\s+(.+)/i,
  );

  let subject = afterOrgVerb ? afterOrgVerb[1] : title;

  subject = subject
    .replace(
      /\s+(?:released|launched|announced|unveiled|introduced|with|featuring|including|achieving|reaches|open-source|open source|as\s).*$/i,
      "",
    )
    .trim();

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

  subject = subject.replace(/^\w+'s\s+/i, "").trim();
  subject = subject.replace(/^full\s+version\s+of\s+/i, "").trim();

  if (subject.length > 30) {
    subject = subject.slice(0, 30).trim();
  }

  return subject || title.slice(0, 25).trim();
}

export async function checkHackerNews(
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
    const res = await fetch(`https://hn.algolia.com/api/v1/search?${params}`);
    if (!res.ok) {
      return { topPoints: 0, topComments: 0, totalStories: 0 };
    }

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

export async function findWikipediaArticle(
  keyword: string,
): Promise<string | null> {
  try {
    const params = new URLSearchParams({
      action: "opensearch",
      search: keyword,
      limit: "1",
      format: "json",
    });
    const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`);
    if (!res.ok) {
      return null;
    }

    const data = (await res.json()) as [string, string[]];
    return data[1]?.[0] ?? null;
  } catch {
    return null;
  }
}

export async function checkWikipediaPageviews(
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
    if (!res.ok) {
      return { peakViews: 0, avgViews: 0 };
    }

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

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function writeAuditLog(log: AuditLog, logsDir: string): string {
  fs.mkdirSync(logsDir, { recursive: true });
  const filename = `eval-${log.timestamp.replace(/[:.]/g, "-")}.json`;
  const filepath = path.join(logsDir, filename);
  fs.writeFileSync(filepath, JSON.stringify(log, null, 2) + "\n", "utf-8");
  return filepath;
}
