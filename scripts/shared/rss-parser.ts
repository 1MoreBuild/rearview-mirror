import { XMLParser } from "fast-xml-parser";

export interface RssItem {
  title: string;
  link: string;
  pubDate: string;
  contentHtml: string;
  guid: string;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

function normalizeDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toISOString().split("T")[0];
}

function parseItems(feed: Record<string, unknown>): RssItem[] {
  // Handle RSS 2.0 format
  const channel =
    (feed as Record<string, Record<string, unknown>>).rss?.channel;
  if (channel) {
    const items = Array.isArray(channel.item)
      ? channel.item
      : channel.item
        ? [channel.item]
        : [];
    return items.map(
      (item: Record<string, string | Record<string, string>>) => ({
        title: String(item.title ?? ""),
        link: String(item.link ?? ""),
        pubDate: normalizeDate(String(item.pubDate ?? "")),
        contentHtml: String(
          item["content:encoded"] ?? item.description ?? "",
        ),
        guid: String(
          typeof item.guid === "object"
            ? item.guid?.["#text"] ?? ""
            : (item.guid ?? item.link ?? ""),
        ),
      }),
    );
  }

  // Handle Atom format
  const atomFeed = (feed as Record<string, Record<string, unknown>>).feed;
  if (atomFeed) {
    const entries = Array.isArray(atomFeed.entry)
      ? atomFeed.entry
      : atomFeed.entry
        ? [atomFeed.entry]
        : [];
    return entries.map(
      (entry: Record<string, string | Record<string, string>>) => {
        const link =
          typeof entry.link === "object"
            ? entry.link?.["@_href"] ?? ""
            : String(entry.link ?? "");
        return {
          title: String(entry.title ?? ""),
          link: String(link),
          pubDate: normalizeDate(
            String(entry.published ?? entry.updated ?? ""),
          ),
          contentHtml: String(entry.content ?? entry.summary ?? ""),
          guid: String(entry.id ?? link),
        };
      },
    );
  }

  throw new Error("Unrecognized feed format: neither RSS 2.0 nor Atom found");
}

export async function fetchRssItems(feedUrl: string): Promise<RssItem[]> {
  const response = await fetch(feedUrl, {
    headers: {
      Accept: "application/rss+xml, application/atom+xml, application/xml",
      "User-Agent": "rearview-mirror/1.0 (AI Timeline Aggregator)",
    },
  });

  if (!response.ok) {
    throw new Error(
      `RSS fetch failed: ${response.status} ${response.statusText}`,
    );
  }

  const xml = await response.text();
  const parsed = parser.parse(xml);
  return parseItems(parsed);
}

export async function fetchNewRssItems(
  feedUrl: string,
  afterDate: string,
): Promise<RssItem[]> {
  const items = await fetchRssItems(feedUrl);
  const cutoff = new Date(afterDate);

  return items.filter((item) => {
    const itemDate = new Date(item.pubDate);
    return itemDate > cutoff;
  });
}
