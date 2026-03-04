/**
 * Two-phase pipeline for fetching pelican SVGs from Simon Willison's blog.
 *
 * Phase 1 — fetch:    Download blog HTML to local cache (incremental, skip if cached)
 * Phase 2 — extract:  Read cached HTML, use MiniMax M2.5 to extract SVGs
 *
 * Every step is logged to data/logs/pelican-fetch-{date}/ for human audit:
 *   - fetch.log.json   — per-URL fetch status, HTTP code, sizes
 *   - html/             — cached HTML files (raw + stripped)
 *   - extract.log.json  — per-URL LLM prompt, response, extracted SVGs
 *
 * Usage:
 *   # Phase 1: fetch blog pages to local cache
 *   npx tsx scripts/fetch-pelican-svgs.ts fetch [--limit N]
 *
 *   # Phase 2: extract SVGs from cached HTML (requires API key)
 *   npx tsx scripts/fetch-pelican-svgs.ts extract [--limit N] [--dry-run] [--rescan]
 *
 *   # Run both phases in sequence
 *   npx tsx scripts/fetch-pelican-svgs.ts all [--limit N] [--rescan]
 *
 * Flags:
 *   --rescan   Re-process all entries (not just placeholders) to find additional images
 */

import fs from "node:fs";
import path from "node:path";

// ─── Paths ──────────────────────────────────────────────────────────────────

const DATA_PATH = path.resolve(__dirname, "../data/pelican_timeline.json");
const SVG_DIR = path.resolve(__dirname, "../public/pelican-svgs");
const CACHE_DIR = path.resolve(__dirname, "../data/pelican-cache");
const STRIPPED_DIR = path.resolve(CACHE_DIR, "stripped");
const LOGS_DIR = path.resolve(__dirname, "../data/logs");

// ─── CLI args ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0] ?? "all";
const dryRun = args.includes("--dry-run");
const rescan = args.includes("--rescan");
const limitIdx = args.indexOf("--limit");
const limit = limitIdx !== -1 ? Number(args[limitIdx + 1]) : Infinity;

// ─── Types ──────────────────────────────────────────────────────────────────

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

type UrlGroup = {
  url: string;
  entries: PelicanEntry[];
};

type FetchLogEntry = {
  url: string;
  cacheFile: string;
  status: "cached" | "fetched" | "error";
  httpStatus?: number;
  rawSize?: number;
  strippedSize?: number;
  error?: string;
};

type ExtractLogEntry = {
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

// ─── Helpers ────────────────────────────────────────────────────────────────

function isPlaceholder(svgFile: string): boolean {
  const svgPath = path.join(SVG_DIR, svgFile);
  try {
    const content = fs.readFileSync(svgPath, "utf-8");
    return content.includes("placeholder");
  } catch {
    return true;
  }
}

function hasOnlyPlaceholders(entry: PelicanEntry): boolean {
  return entry.svg_files.every((f) => isPlaceholder(f));
}

function urlToFilename(url: string): string {
  return url
    .replace(/^https?:\/\//, "")
    .replace(/[^a-zA-Z0-9.-]/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/_$/, "");
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function stripHtmlNoise(html: string): string {
  let cleaned = html;
  for (const tag of ["script", "style", "nav", "footer", "head", "noscript"]) {
    const re = new RegExp(`<${tag}[\\s\\S]*?</${tag}\\s*>`, "gi");
    cleaned = cleaned.replace(re, "");
  }
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, "");
  cleaned = cleaned.replace(/\s{3,}/g, "\n\n");
  return cleaned.trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getProcessableGroups(): UrlGroup[] {
  const data: PelicanData = JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));
  const urlGroups = new Map<string, PelicanEntry[]>();

  for (const entry of data.entries) {
    if (!entry.blog_url) continue;
    // In rescan mode, process all entries; otherwise only placeholders
    if (!rescan && !hasOnlyPlaceholders(entry)) continue;
    const existing = urlGroups.get(entry.blog_url) ?? [];
    existing.push(entry);
    urlGroups.set(entry.blog_url, existing);
  }

  return [...urlGroups.entries()]
    .map(([url, entries]) => ({ url, entries }))
    .slice(0, limit);
}

function ensureDirs() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.mkdirSync(STRIPPED_DIR, { recursive: true });
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// ─── Phase 1: Fetch ─────────────────────────────────────────────────────────

async function phaseFetch() {
  console.log("═══ Phase 1: Fetch blog pages ═══\n");
  ensureDirs();

  const groups = getProcessableGroups();
  console.log(`${groups.length} URLs to process\n`);

  const log: FetchLogEntry[] = [];
  let cachedCount = 0;
  let fetchedCount = 0;
  let errorCount = 0;

  for (let i = 0; i < groups.length; i++) {
    const { url, entries } = groups[i];
    const cacheFile = urlToFilename(url) + ".html";
    const cachePath = path.join(CACHE_DIR, cacheFile);
    const strippedPath = path.join(STRIPPED_DIR, cacheFile);

    const models = entries.map((e) => e.model);
    console.log(`[${i + 1}/${groups.length}] ${url}`);
    console.log(`  Models: ${models.join(", ")}`);

    // Skip if already cached
    if (fs.existsSync(cachePath)) {
      const rawSize = fs.statSync(cachePath).size;
      const strippedSize = fs.existsSync(strippedPath)
        ? fs.statSync(strippedPath).size
        : 0;
      console.log(`  → Cached (${rawSize} bytes raw, ${strippedSize} bytes stripped)\n`);
      log.push({ url, cacheFile, status: "cached", rawSize, strippedSize });
      cachedCount++;
      continue;
    }

    // Fetch
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; rearview-mirror/1.0; pelican-svg-fetcher)",
        },
      });

      if (!response.ok) {
        console.log(`  ✗ HTTP ${response.status}\n`);
        log.push({
          url,
          cacheFile,
          status: "error",
          httpStatus: response.status,
          error: `HTTP ${response.status}`,
        });
        errorCount++;
        await sleep(1000);
        continue;
      }

      const html = await response.text();
      fs.writeFileSync(cachePath, html, "utf-8");

      const stripped = stripHtmlNoise(html);
      fs.writeFileSync(strippedPath, stripped, "utf-8");

      console.log(`  ✓ Fetched: ${html.length} bytes raw → ${stripped.length} bytes stripped\n`);
      log.push({
        url,
        cacheFile,
        status: "fetched",
        httpStatus: response.status,
        rawSize: html.length,
        strippedSize: stripped.length,
      });
      fetchedCount++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ✗ ${msg}\n`);
      log.push({ url, cacheFile, status: "error", error: msg });
      errorCount++;
    }

    if (i < groups.length - 1) await sleep(1500);
  }

  // Write log
  const logPath = path.join(LOGS_DIR, `pelican-fetch-${Date.now()}.json`);
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2));

  console.log("─".repeat(50));
  console.log(
    `Fetch done. Cached: ${cachedCount}, Fetched: ${fetchedCount}, Errors: ${errorCount}`,
  );
  console.log(`Log: ${logPath}\n`);

  return log;
}

// ─── Phase 2: Extract ───────────────────────────────────────────────────────

function buildExtractionPrompt(models: string[], html: string): string {
  const modelList = models.map((m) => `"${m}"`).join(", ");

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

type ExtractionResult = {
  type: "svg";
  content: string;
} | {
  type: "external";
  url: string;
} | {
  type: "not_found";
};

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

function parseExtractionResponse(
  response: string,
  models: string[],
): Map<string, ExtractionResult[]> {
  const result = new Map<string, ExtractionResult[]>();

  // Split by === markers
  const sections = response.split(/^===\s*/m);

  for (const section of sections) {
    const headerMatch = section.match(/^(.+?)\s*===\s*\n([\s\S]*)/);
    if (!headerMatch) continue;

    const modelName = headerMatch[1].trim();
    const content = headerMatch[2].trim();

    const matchedModel = models.find(
      (m) =>
        modelName.toLowerCase().includes(m.toLowerCase()) ||
        m.toLowerCase().includes(modelName.toLowerCase()),
    );

    if (!matchedModel) continue;

    // Split by --- NEXT IMAGE --- for multiple images
    const imageSections = content.split(/---\s*NEXT\s*IMAGE\s*---/i);
    const results: ExtractionResult[] = [];

    for (const imgSection of imageSections) {
      const parsed = parseSingleResult(imgSection);
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

type FetchedImage =
  | { type: "svg"; content: string }
  | { type: "raster"; data: Buffer; ext: string }
  | null;

async function fetchExternalImage(url: string): Promise<FetchedImage> {
  // GitHub Gist URLs need /raw suffix to get raw content
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

    // Handle raster images — download as binary
    if (contentType.includes("image/png")) {
      const buf = Buffer.from(await response.arrayBuffer());
      console.log(`    ↓ PNG: ${buf.length} bytes`);
      return { type: "raster", data: buf, ext: ".png" };
    }
    if (contentType.includes("image/jpeg")) {
      const buf = Buffer.from(await response.arrayBuffer());
      console.log(`    ↓ JPEG: ${buf.length} bytes`);
      return { type: "raster", data: buf, ext: ".jpg" };
    }
    if (contentType.includes("image/webp")) {
      const buf = Buffer.from(await response.arrayBuffer());
      console.log(`    ↓ WebP: ${buf.length} bytes`);
      return { type: "raster", data: buf, ext: ".webp" };
    }

    // Handle SVG / text responses
    const text = await response.text();

    if (!text.includes("<svg")) {
      console.log(`    ⚠ No <svg> in response from ${resolvedUrl}`);
      return null;
    }

    // Extract SVG from HTML wrapper if needed
    if (text.includes("<!DOCTYPE") || text.includes("<html")) {
      const svgMatch = text.match(/<svg[\s\S]*<\/svg>/i);
      if (svgMatch) {
        console.log(`    ℹ Extracted SVG from HTML wrapper`);
        return { type: "svg", content: svgMatch[0] };
      }
      console.log(`    ⚠ HTML page but no extractable SVG`);
      return null;
    }

    return { type: "svg", content: text };
  } catch (err) {
    console.log(`    ✗ External fetch error: ${resolvedUrl}`);
    return null;
  }
}

/** Generate a filename for an additional image (2nd, 3rd, etc.) */
function makeImageFilename(baseSlug: string, date: string, index: number, ext: string): string {
  const suffix = index === 0 ? "" : `-${index + 1}`;
  return `${slugify(baseSlug)}-${date}${suffix}${ext}`;
}

async function phaseExtract() {
  console.log("═══ Phase 2: Extract SVGs via LLM ═══\n");
  if (rescan) console.log("  (rescan mode — re-processing all entries)\n");

  // Lazy-load openrouter client (needs OPENROUTER_API_KEY)
  const { chatCompletion } = await import("./shared/openrouter-client");

  ensureDirs();

  const groups = getProcessableGroups();

  // Only process groups that have cached HTML
  const processable = groups.filter((g) => {
    const strippedPath = path.join(STRIPPED_DIR, urlToFilename(g.url) + ".html");
    return fs.existsSync(strippedPath);
  });

  console.log(
    `${processable.length} URLs with cached HTML (${groups.length - processable.length} not yet fetched)\n`,
  );

  const log: ExtractLogEntry[] = [];
  const data: PelicanData = JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));
  let successCount = 0;
  let errorCount = 0;
  let newImagesCount = 0;

  for (let i = 0; i < processable.length; i++) {
    const { url, entries } = processable[i];
    const cacheFile = urlToFilename(url) + ".html";
    const strippedPath = path.join(STRIPPED_DIR, cacheFile);
    const models = entries.map((e) => e.model);

    console.log(`[${i + 1}/${processable.length}] ${url}`);
    console.log(`  Models: ${models.join(", ")}`);

    // Read cached stripped HTML
    let html = fs.readFileSync(strippedPath, "utf-8");

    // Truncate if too long
    const maxChars = 120_000;
    if (html.length > maxChars) {
      console.log(`  ⚠ Truncating: ${html.length} → ${maxChars} chars`);
      html = html.slice(0, maxChars) + "\n[TRUNCATED]";
    }

    const prompt = buildExtractionPrompt(models, html);
    console.log(`  Prompt: ${prompt.length} chars`);

    try {
      const response = await chatCompletion(
        [{ role: "user", content: prompt }],
        { temperature: 0, maxTokens: 16_000 },
      );

      console.log(`  Response: ${response.length} chars`);

      const extracted = parseExtractionResponse(response, models);

      const logResults: ExtractLogEntry["results"] = [];

      for (const entry of entries) {
        const extractions = extracted.get(entry.model) ?? [{ type: "not_found" as const }];
        const allNotFound = extractions.every((e) => e.type === "not_found");

        if (allNotFound) {
          console.log(`  ✗ ${entry.model}: not found`);
          logResults.push({
            model: entry.model,
            files: entry.svg_files,
            status: "not_found",
          });
          continue;
        }

        const savedFiles: string[] = [];
        let imgIndex = 0;

        for (const extraction of extractions) {
          if (extraction.type === "not_found") continue;

          if (extraction.type === "svg") {
            const filename = makeImageFilename(entry.model, entry.date, imgIndex, ".svg");
            if (dryRun) {
              console.log(`  ✓ ${entry.model} [${imgIndex + 1}]: SVG ${extraction.content.length} chars (dry-run) → ${filename}`);
            } else {
              fs.writeFileSync(path.join(SVG_DIR, filename), extraction.content, "utf-8");
              console.log(`  ✓ ${entry.model} [${imgIndex + 1}]: SVG ${extraction.content.length} chars → ${filename}`);
            }
            savedFiles.push(filename);
            imgIndex++;
          } else if (extraction.type === "external") {
            console.log(`  ↗ ${entry.model} [${imgIndex + 1}]: external → ${extraction.url}`);
            const fetched = await fetchExternalImage(extraction.url);

            if (!fetched) {
              console.log(`  ✗ ${entry.model} [${imgIndex + 1}]: failed to download`);
              continue;
            }

            if (fetched.type === "svg") {
              const filename = makeImageFilename(entry.model, entry.date, imgIndex, ".svg");
              if (!dryRun) {
                fs.writeFileSync(path.join(SVG_DIR, filename), fetched.content, "utf-8");
              }
              console.log(`  ✓ ${entry.model} [${imgIndex + 1}]: SVG ${fetched.content.length} chars → ${filename}`);
              savedFiles.push(filename);
            } else {
              // Raster image — save with correct extension + ensure placeholder SVG exists
              const filename = makeImageFilename(entry.model, entry.date, imgIndex, fetched.ext);
              const placeholderSvg = makeImageFilename(entry.model, entry.date, imgIndex, ".svg");
              if (!dryRun) {
                fs.writeFileSync(path.join(SVG_DIR, filename), fetched.data);
                // Create placeholder SVG so raster fallback detection works
                const placeholderPath = path.join(SVG_DIR, placeholderSvg);
                if (!fs.existsSync(placeholderPath)) {
                  const label = entry.model;
                  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="#f8f8f8"/><text x="200" y="185" text-anchor="middle" font-family="system-ui" font-size="14" fill="#bbb">placeholder</text><text x="200" y="215" text-anchor="middle" font-family="system-ui" font-size="12" fill="#ccc">${label}</text></svg>\n`;
                  fs.writeFileSync(placeholderPath, svg, "utf-8");
                  console.log(`  📄 Created placeholder: ${placeholderSvg}`);
                }
              }
              console.log(`  ✓ ${entry.model} [${imgIndex + 1}]: ${fetched.ext} ${fetched.data.length} bytes → ${filename}`);
              savedFiles.push(placeholderSvg);
            }
            imgIndex++;
          }
        }

        if (savedFiles.length > 0) {
          // Update the entry's svg_files in-memory
          const dataEntry = data.entries.find(
            (e) => e.model === entry.model && e.date === entry.date,
          );
          if (dataEntry) {
            const before = dataEntry.svg_files.length;
            dataEntry.svg_files = savedFiles;
            const added = savedFiles.length - before;
            if (added > 0) newImagesCount += added;
            console.log(`  📝 ${entry.model}: ${savedFiles.length} files (was ${before})`);
          }
        }

        logResults.push({
          model: entry.model,
          files: savedFiles,
          status: savedFiles.length > 0 ? "extracted" : "not_found",
          details: `${extractions.length} images found by LLM, ${savedFiles.length} saved`,
        });
      }

      log.push({
        url,
        models,
        cacheFile,
        promptLength: prompt.length,
        responseLength: response.length,
        prompt,
        response,
        results: logResults,
      });
      successCount++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ✗ LLM error: ${msg}`);
      log.push({
        url,
        models,
        cacheFile,
        promptLength: 0,
        responseLength: 0,
        prompt: "",
        response: "",
        results: entries.map((e) => ({
          model: e.model,
          files: e.svg_files,
          status: "not_found" as const,
        })),
      });
      errorCount++;
    }

    console.log();
    if (i < processable.length - 1) await sleep(2000);
  }

  // Save updated JSON
  if (!dryRun) {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + "\n");
    console.log(`Updated ${DATA_PATH}`);
  }

  // Write log (includes full prompts + responses for audit)
  const logPath = path.join(LOGS_DIR, `pelican-extract-${Date.now()}.json`);
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2));

  console.log("─".repeat(50));
  console.log(`Extract done. URLs: ${successCount}, Errors: ${errorCount}, New images: ${newImagesCount}`);
  console.log(`Log: ${logPath}`);
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  if (!["fetch", "extract", "all"].includes(command)) {
    console.error(`Unknown command: ${command}`);
    console.error("Usage: npx tsx scripts/fetch-pelican-svgs.ts <fetch|extract|all> [--limit N] [--dry-run] [--rescan]");
    process.exit(1);
  }

  if (command === "fetch" || command === "all") {
    await phaseFetch();
  }

  if (command === "extract" || command === "all") {
    await phaseExtract();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
