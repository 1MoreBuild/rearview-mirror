import fs from "node:fs";
import path from "node:path";

export type PelicanEntry = {
  date: string;
  model: string;
  provider: string;
  svg_files: string[];
  blog_url?: string;
  notes?: string;
};

export type PelicanData = {
  version: number;
  entries: PelicanEntry[];
};

export type UrlGroup = {
  url: string;
  entries: PelicanEntry[];
};

export type FetchLogEntry = {
  url: string;
  cacheFile: string;
  status: "cached" | "fetched" | "error";
  httpStatus?: number;
  rawSize?: number;
  strippedSize?: number;
  error?: string;
};

export type ExtractLogEntry = {
  url: string;
  models: string[];
  cacheFile: string;
  promptLength: number;
  responseLength: number;
  prompt: string;
  response: string;
  results: {
    model: string;
    files: string[];
    status: "extracted" | "not_found";
    details?: string;
  }[];
};

function isPlaceholder(svgFile: string, svgDir: string): boolean {
  const svgPath = path.join(svgDir, svgFile);
  try {
    const content = fs.readFileSync(svgPath, "utf-8");
    return content.includes("placeholder");
  } catch {
    return true;
  }
}

function hasOnlyPlaceholders(entry: PelicanEntry, svgDir: string): boolean {
  return entry.svg_files.every((fileName) => isPlaceholder(fileName, svgDir));
}

export function urlToFilename(url: string): string {
  return url
    .replace(/^https?:\/\//, "")
    .replace(/[^a-zA-Z0-9.-]/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/_$/, "");
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function stripHtmlNoise(html: string): string {
  let cleaned = html;
  for (const tag of ["script", "style", "nav", "footer", "head", "noscript"]) {
    const re = new RegExp(`<${tag}[\\s\\S]*?</${tag}\\s*>`, "gi");
    cleaned = cleaned.replace(re, "");
  }
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, "");
  cleaned = cleaned.replace(/\s{3,}/g, "\n\n");
  return cleaned.trim();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getProcessableGroups(params: {
  dataPath: string;
  rescan: boolean;
  limit: number;
  svgDir: string;
}): UrlGroup[] {
  const data: PelicanData = JSON.parse(fs.readFileSync(params.dataPath, "utf-8"));
  const urlGroups = new Map<string, PelicanEntry[]>();

  for (const entry of data.entries) {
    if (!entry.blog_url) {
      continue;
    }
    if (!params.rescan && !hasOnlyPlaceholders(entry, params.svgDir)) {
      continue;
    }

    const existing = urlGroups.get(entry.blog_url) ?? [];
    existing.push(entry);
    urlGroups.set(entry.blog_url, existing);
  }

  return [...urlGroups.entries()]
    .map(([url, entries]) => ({ url, entries }))
    .slice(0, params.limit);
}

export function ensureDirs(cacheDir: string, strippedDir: string, logsDir: string) {
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.mkdirSync(strippedDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });
}

export function buildExtractionPrompt(models: string[], html: string): string {
  const modelList = models.map((model) => `"${model}"`).join(", ");

  return `You are extracting pelican-riding-a-bicycle images from a blog post by Simon Willison.

I need ALL pelican images for these models: ${modelList}

A single model may have MULTIPLE pelican drawings (e.g. one from the simple prompt, another from a detailed prompt, or different attempts). Find ALL of them.

Look for BOTH inline <svg> elements AND <img> tags that show pelican drawings for each model.

RULES:
- If you find an inline <svg>...</svg>, return the complete SVG markup
- If the image is an <img> tag with a URL (png, jpg, svg, etc.), output: EXTERNAL: <full-url>
- Separate each model's results with: === MODEL_NAME ===
- If a model has multiple images, list them all under its section, separated by: --- NEXT IMAGE ---
- If a model's pelican image is truly not in the page, output NOT_FOUND under its section
- The pelican images are often near text mentioning the model name, or near "pelican riding a bicycle"
- Do NOT return site decoration SVGs (icons, logos) — only pelican benchmark drawings
- Return ONLY markup or EXTERNAL lines, no explanations

Return each result separated by the === markers:

---
${html}`;
}

export type ExtractionResult =
  | { type: "svg"; content: string }
  | { type: "external"; url: string }
  | { type: "not_found" };

function parseSingleResult(content: string): ExtractionResult {
  const trimmed = content.trim();
  if (trimmed === "NOT_FOUND") {
    return { type: "not_found" };
  }

  const externalMatch = trimmed.match(/EXTERNAL:\s*(https?:\/\/\S+)/i);
  if (externalMatch) {
    return { type: "external", url: externalMatch[1] };
  }

  const svgMatch = trimmed.match(/<svg[\s\S]*<\/svg>/i);
  if (svgMatch) {
    return { type: "svg", content: svgMatch[0] };
  }

  return { type: "not_found" };
}

export function parseExtractionResponse(
  response: string,
  models: string[],
): Map<string, ExtractionResult[]> {
  const result = new Map<string, ExtractionResult[]>();
  const sections = response.split(/^===\s*/m);

  for (const section of sections) {
    const headerMatch = section.match(/^(.+?)\s*===\s*\n([\s\S]*)/);
    if (!headerMatch) {
      continue;
    }

    const modelName = headerMatch[1].trim();
    const content = headerMatch[2].trim();

    const matchedModel = models.find(
      (model) =>
        modelName.toLowerCase().includes(model.toLowerCase()) ||
        model.toLowerCase().includes(modelName.toLowerCase()),
    );
    if (!matchedModel) {
      continue;
    }

    const imageSections = content.split(/---\s*NEXT\s*IMAGE\s*---/i);
    const results: ExtractionResult[] = [];

    for (const imageSection of imageSections) {
      const parsed = parseSingleResult(imageSection);
      if (parsed.type !== "not_found") {
        results.push(parsed);
      }
    }

    result.set(matchedModel, results.length > 0 ? results : [{ type: "not_found" }]);
  }

  for (const model of models) {
    if (!result.has(model)) {
      result.set(model, [{ type: "not_found" }]);
    }
  }

  return result;
}

export type FetchedImage =
  | { type: "svg"; content: string }
  | { type: "raster"; data: Buffer; ext: string }
  | null;

export async function fetchExternalImage(url: string): Promise<FetchedImage> {
  let resolvedUrl = url;
  if (resolvedUrl.includes("gist.github.com") && !resolvedUrl.endsWith("/raw")) {
    resolvedUrl = resolvedUrl.replace(/\/?$/, "/raw");
  }

  try {
    const response = await fetch(resolvedUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; rearview-mirror/1.0; pelican-svg-fetcher)",
      },
    });
    if (!response.ok) {
      console.log(`    ✗ External HTTP ${response.status}: ${resolvedUrl}`);
      return null;
    }

    const contentType = response.headers.get("content-type") ?? "";

    if (contentType.includes("image/png")) {
      const buffer = Buffer.from(await response.arrayBuffer());
      console.log(`    ↓ PNG: ${buffer.length} bytes`);
      return { type: "raster", data: buffer, ext: ".png" };
    }
    if (contentType.includes("image/jpeg")) {
      const buffer = Buffer.from(await response.arrayBuffer());
      console.log(`    ↓ JPEG: ${buffer.length} bytes`);
      return { type: "raster", data: buffer, ext: ".jpg" };
    }
    if (contentType.includes("image/webp")) {
      const buffer = Buffer.from(await response.arrayBuffer());
      console.log(`    ↓ WebP: ${buffer.length} bytes`);
      return { type: "raster", data: buffer, ext: ".webp" };
    }

    const text = await response.text();
    if (!text.includes("<svg")) {
      console.log(`    ⚠ No <svg> in response from ${resolvedUrl}`);
      return null;
    }

    if (text.includes("<!DOCTYPE") || text.includes("<html")) {
      const svgMatch = text.match(/<svg[\s\S]*<\/svg>/i);
      if (svgMatch) {
        console.log("    ℹ Extracted SVG from HTML wrapper");
        return { type: "svg", content: svgMatch[0] };
      }
      console.log("    ⚠ HTML page but no extractable SVG");
      return null;
    }

    return { type: "svg", content: text };
  } catch {
    console.log(`    ✗ External fetch error: ${resolvedUrl}`);
    return null;
  }
}

export function makeImageFilename(
  baseSlug: string,
  date: string,
  index: number,
  ext: string,
): string {
  const suffix = index === 0 ? "" : `-${index + 1}`;
  return `${slugify(baseSlug)}-${date}${suffix}${ext}`;
}

export function buildPlaceholderSvg(label: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="#f8f8f8"/><text x="200" y="185" text-anchor="middle" font-family="system-ui" font-size="14" fill="#bbb">placeholder</text><text x="200" y="215" text-anchor="middle" font-family="system-ui" font-size="12" fill="#ccc">${label}</text></svg>\n`;
}
