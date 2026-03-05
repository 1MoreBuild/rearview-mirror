import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TAG_URL = "https://simonwillison.net/tags/pelican-riding-a-bicycle/";
const SIMON_ORIGIN = "https://simonwillison.net";
const DATA_PATH = path.resolve(__dirname, "../data/pelican_timeline.json");
const SVG_DIR = path.resolve(__dirname, "../public/pelican-svgs");

type PelicanEntry = {
  date: string;
  model: string;
  provider: string;
  svg_files: string[];
  blog_url?: string;
  notes?: string;
};

type PelicanData = {
  version: number;
  entries: PelicanEntry[];
};

type DiscoveredPost = {
  date: string;
  model: string;
  provider: string;
  blogUrl: string;
  imageUrls: string[];
};

const MODEL_FAMILY_TOKENS = [
  "gpt",
  "gemini",
  "claude",
  "qwen",
  "llama",
  "deepseek",
  "grok",
  "kimi",
  "glm",
  "minimax",
  "devstral",
  "mistral",
  "olmo",
  "o1",
  "o3",
  "o4",
  "swe",
  "composer",
] as const;
const MODEL_KEYWORD_RE = new RegExp(
  `\\b(${MODEL_FAMILY_TOKENS.join("|")})(?=\\b|\\d)`,
  "i",
);
const IGNORED_DESCRIPTOR_TOKENS = new Set(["model", "models", "preview", "release", "series"]);

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function decodeHtml(input: string): string {
  return input
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) =>
      String.fromCodePoint(parseInt(n, 16)),
    )
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

export function normalizeModel(raw: string): string {
  let model = decodeHtml(raw)
    .replace(/<[^>]+>/g, "")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  model = model
    .replace(/^Introducing\s+/i, "")
    .replace(/^Announcing\s+/i, "")
    .replace(/^Introducing the\s+/i, "");

  if (model.includes(":")) {
    model = model.split(":")[0].trim();
  }

  return model;
}

export function looksLikeModelName(model: string): boolean {
  return MODEL_KEYWORD_RE.test(model) && /\d/.test(model);
}

export function inferProvider(tags: string[], model: string): string {
  const tagSet = new Set(tags.map((t) => t.toLowerCase()));
  const lowerModel = model.toLowerCase();

  if (tagSet.has("openai") || /\b(gpt|o1|o3|o4|codex)\b/.test(lowerModel)) {
    return "OpenAI";
  }
  if (tagSet.has("anthropic") || lowerModel.includes("claude")) {
    return "Anthropic";
  }
  if (tagSet.has("google") || lowerModel.includes("gemini")) {
    return "Google";
  }
  if (tagSet.has("qwen") || lowerModel.includes("qwen")) {
    return "Alibaba";
  }
  if (tagSet.has("deepseek") || lowerModel.includes("deepseek")) {
    return "DeepSeek";
  }
  if (lowerModel.includes("llama")) {
    return "Meta";
  }
  if (tagSet.has("glm") || lowerModel.includes("glm")) {
    return "Z.ai";
  }
  if (tagSet.has("minimax") || lowerModel.includes("minimax")) {
    return "MiniMax";
  }
  if (tagSet.has("kimi") || lowerModel.includes("kimi")) {
    return "Moonshot";
  }
  if (tagSet.has("mistral") || lowerModel.includes("mistral") || lowerModel.includes("devstral")) {
    return "Mistral";
  }
  if (tagSet.has("grok") || lowerModel.includes("grok")) {
    return "xAI";
  }
  return "Unknown";
}

export function parseDateFromPermalink(url: string): string | null {
  const match = url.match(/\/(\d{4})\/([a-z]{3})\/(\d{1,2})\//i);
  if (!match) return null;

  const [, yyyy, monthRaw, ddRaw] = match;
  const month = monthRaw.toLowerCase();
  const monthMap: Record<string, string> = {
    jan: "01",
    feb: "02",
    mar: "03",
    apr: "04",
    may: "05",
    jun: "06",
    jul: "07",
    aug: "08",
    sep: "09",
    oct: "10",
    nov: "11",
    dec: "12",
  };
  const mm = monthMap[month];
  if (!mm) return null;
  const dd = ddRaw.padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function splitBlogmarkSegments(html: string): string[] {
  return html
    .split('<div class="blogmark segment')
    .slice(1)
    .map((part) => `<div class="blogmark segment${part}`);
}

function normalizeForMatching(input: string): string {
  return decodeHtml(input)
    .toLowerCase()
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/([a-z])(\d)/gi, "$1 $2")
    .replace(/(\d)([a-z])/gi, "$1 $2")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeForMatching(input: string): string[] {
  return normalizeForMatching(input)
    .split(" ")
    .filter((token) => token.length > 0);
}

function extractAttr(tagHtml: string, attr: string): string {
  const pattern = new RegExp(`${attr}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i");
  const match = tagHtml.match(pattern);
  return match?.[2] ?? match?.[3] ?? "";
}

function getModelSignals(model: string): {
  family: string | null;
  versionTokens: string[];
  descriptorTokens: string[];
} {
  const tokens = tokenizeForMatching(model);
  const family = tokens.find((token) =>
    MODEL_FAMILY_TOKENS.includes(token as (typeof MODEL_FAMILY_TOKENS)[number]),
  );
  const versionTokens = tokens.filter((token) => /^\d+$/.test(token));
  const descriptorTokens = tokens.filter(
    (token) =>
      token.length >= 3 &&
      token !== family &&
      !/^\d+$/.test(token) &&
      !IGNORED_DESCRIPTOR_TOKENS.has(token),
  );
  return {
    family: family ?? null,
    versionTokens: [...new Set(versionTokens)],
    descriptorTokens: [...new Set(descriptorTokens)],
  };
}

export function extractImageUrls(segment: string, model: string): string[] {
  const imgTags = [...segment.matchAll(/<img\b[^>]*>/gi)];
  const candidates = imgTags
    .map((match) => {
      const tagHtml = match[0];
      const src = extractAttr(tagHtml, "src");
      if (!src) return null;

      let url = "";
      try {
        url = new URL(src, SIMON_ORIGIN).toString();
      } catch {
        return null;
      }

      if (!url.includes("static.simonwillison.net/static/")) return null;

      const alt = extractAttr(tagHtml, "alt");
      const tokens = new Set(tokenizeForMatching(`${url} ${alt}`));
      return {
        url,
        tokens,
      };
    })
    .filter(
      (
        candidate,
      ): candidate is {
        url: string;
        tokens: Set<string>;
      } => Boolean(candidate),
    );

  const { family, versionTokens, descriptorTokens } = getModelSignals(model);
  if (!family) {
    return [...new Set(candidates.map((candidate) => candidate.url))];
  }

  const hasToken = (candidate: { tokens: Set<string> }, token: string): boolean =>
    candidate.tokens.has(token);

  const familyAndVersionMatches = candidates.filter(
    (candidate) =>
      hasToken(candidate, family) &&
      versionTokens.every((token) => hasToken(candidate, token)),
  );
  const familyMatches =
    familyAndVersionMatches.length > 0
      ? familyAndVersionMatches
      : candidates.filter((candidate) => hasToken(candidate, family));

  let selected = familyMatches;
  if (descriptorTokens.length > 0 && familyMatches.length > 0) {
    const fullDescriptorMatches = familyMatches.filter((candidate) =>
      descriptorTokens.every((token) => hasToken(candidate, token)),
    );
    if (fullDescriptorMatches.length > 0) {
      selected = fullDescriptorMatches;
    }
  }

  const fallback = selected.length > 0 ? selected : candidates;
  return [...new Set(fallback.map((candidate) => candidate.url))];
}

export function discoverPosts(html: string): DiscoveredPost[] {
  const segments = splitBlogmarkSegments(html);
  const posts: DiscoveredPost[] = [];

  for (const segment of segments) {
    if (!segment.includes('/tags/llm-release/')) continue;

    const permalinkMatch = segment.match(/<a href="([^"]+)" rel="bookmark">#<\/a>/i);
    const titleMatch = segment.match(/<p><strong><a [^>]*>([\s\S]*?)<\/a><\/strong>/i);
    if (!permalinkMatch || !titleMatch) continue;

    const blogUrl = new URL(permalinkMatch[1], SIMON_ORIGIN).toString();
    const date = parseDateFromPermalink(blogUrl);
    if (!date) continue;

    const model = normalizeModel(titleMatch[1]);
    if (!model || !looksLikeModelName(model)) continue;

    const tags = [...segment.matchAll(/href="\/tags\/([^/"?#]+)\//gi)].map((m) =>
      decodeHtml(m[1].toLowerCase()),
    );
    const provider = inferProvider(tags, model);

    const imageUrls = extractImageUrls(segment, model);
    if (imageUrls.length === 0) continue;

    posts.push({
      date,
      model,
      provider,
      blogUrl,
      imageUrls,
    });
  }

  return posts;
}

function extensionFromContentType(contentType: string): string | null {
  const type = contentType.toLowerCase();
  if (type.includes("image/svg+xml")) return ".svg";
  if (type.includes("image/png")) return ".png";
  if (type.includes("image/jpeg")) return ".jpg";
  if (type.includes("image/webp")) return ".webp";
  return null;
}

function extensionFromUrl(url: string): string | null {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    if (pathname.endsWith(".svg")) return ".svg";
    if (pathname.endsWith(".png")) return ".png";
    if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return ".jpg";
    if (pathname.endsWith(".webp")) return ".webp";
    return null;
  } catch {
    return null;
  }
}

function writeFileIfChanged(filePath: string, content: Buffer | string): boolean {
  if (fs.existsSync(filePath)) {
    const previous = fs.readFileSync(filePath);
    const next = typeof content === "string" ? Buffer.from(content) : content;
    if (previous.equals(next)) return false;
  }
  fs.writeFileSync(filePath, content);
  return true;
}

function buildPlaceholderSvg(model: string): string {
  const label = model.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="#f8f8f8"/><text x="200" y="185" text-anchor="middle" font-family="system-ui" font-size="14" fill="#bbb">placeholder</text><text x="200" y="215" text-anchor="middle" font-family="system-ui" font-size="12" fill="#ccc">${label}</text></svg>\n`;
}

async function saveImagesForPost(post: DiscoveredPost): Promise<string[]> {
  const svgFiles: string[] = [];
  const baseSlug = slugify(post.model);

  for (let i = 0; i < post.imageUrls.length; i++) {
    const imageUrl = post.imageUrls[i];
    const suffix = i === 0 ? "" : `-${i + 1}`;
    const baseName = `${baseSlug}-${post.date}${suffix}`;

    const response = await fetch(imageUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; rearview-mirror/1.0; pelican-tag-sync)",
      },
    });

    if (!response.ok) {
      console.warn(`  - skip image ${imageUrl} (HTTP ${response.status})`);
      continue;
    }

    const contentType = response.headers.get("content-type") ?? "";
    const ext =
      extensionFromUrl(imageUrl) ??
      extensionFromContentType(contentType) ??
      ".png";

    const targetPath = path.join(SVG_DIR, `${baseName}${ext}`);
    if (ext === ".svg") {
      const text = await response.text();
      writeFileIfChanged(targetPath, text);
      svgFiles.push(`${baseName}.svg`);
      continue;
    }

    const binary = Buffer.from(await response.arrayBuffer());
    writeFileIfChanged(targetPath, binary);

    const placeholderName = `${baseName}.svg`;
    const placeholderPath = path.join(SVG_DIR, placeholderName);
    writeFileIfChanged(placeholderPath, buildPlaceholderSvg(post.model));
    svgFiles.push(placeholderName);
  }

  return [...new Set(svgFiles)];
}

export async function main() {
  const data: PelicanData = JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));
  fs.mkdirSync(SVG_DIR, { recursive: true });

  const existingByUrl = new Set(
    data.entries
      .map((entry) => entry.blog_url)
      .filter((url): url is string => Boolean(url)),
  );

  console.log(`Fetching ${TAG_URL}`);
  const htmlResponse = await fetch(TAG_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; rearview-mirror/1.0; pelican-tag-sync)",
    },
  });
  if (!htmlResponse.ok) {
    throw new Error(`Failed to fetch tag page: HTTP ${htmlResponse.status}`);
  }
  const html = await htmlResponse.text();

  const discovered = discoverPosts(html);
  console.log(`Discovered ${discovered.length} candidate posts`);

  let added = 0;
  for (const post of discovered) {
    if (existingByUrl.has(post.blogUrl)) continue;

    const svgFiles = await saveImagesForPost(post);
    if (svgFiles.length === 0) continue;

    const entry: PelicanEntry = {
      date: post.date,
      model: post.model,
      provider: post.provider,
      blog_url: post.blogUrl,
      svg_files: svgFiles,
    };

    data.entries.push(entry);
    existingByUrl.add(post.blogUrl);
    added++;
    console.log(`+ ${post.date} | ${post.model} | ${svgFiles.length} image(s)`);
  }

  if (added === 0) {
    console.log("No new pelican entries found.");
    return;
  }

  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + "\n", "utf-8");
  console.log(`Added ${added} new entries to ${DATA_PATH}`);
}

const scriptPath = fileURLToPath(import.meta.url);
const isRunDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(scriptPath);

if (isRunDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
