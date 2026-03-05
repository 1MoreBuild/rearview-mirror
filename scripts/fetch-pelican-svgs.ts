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
 *   pnpm exec tsx scripts/fetch-pelican-svgs.ts fetch [--limit N]
 *
 *   # Phase 2: extract SVGs from cached HTML (requires API key)
 *   pnpm exec tsx scripts/fetch-pelican-svgs.ts extract [--limit N] [--dry-run] [--rescan]
 *
 *   # Run both phases in sequence
 *   pnpm exec tsx scripts/fetch-pelican-svgs.ts all [--limit N] [--rescan]
 *
 * Flags:
 *   --rescan   Re-process all entries (not just placeholders) to find additional images
 */

import fs from "node:fs";
import path from "node:path";

import {
  buildExtractionPrompt,
  buildPlaceholderSvg,
  ensureDirs,
  type ExtractLogEntry,
  fetchExternalImage,
  type FetchLogEntry,
  getProcessableGroups,
  makeImageFilename,
  type PelicanData,
  parseExtractionResponse,
  sleep,
  stripHtmlNoise,
  urlToFilename,
} from "./fetch-pelican-svgs.helpers";

const DATA_PATH = path.resolve(__dirname, "../data/pelican_timeline.json");
const SVG_DIR = path.resolve(__dirname, "../public/pelican-svgs");
const CACHE_DIR = path.resolve(__dirname, "../data/pelican-cache");
const STRIPPED_DIR = path.resolve(CACHE_DIR, "stripped");
const LOGS_DIR = path.resolve(__dirname, "../data/logs");

const args = process.argv.slice(2);
const command = args[0] ?? "all";
const dryRun = args.includes("--dry-run");
const rescan = args.includes("--rescan");
const limitIdx = args.indexOf("--limit");
const limit = limitIdx !== -1 ? Number(args[limitIdx + 1]) : Infinity;

async function phaseFetch() {
  console.log("═══ Phase 1: Fetch blog pages ═══\n");
  ensureDirs(CACHE_DIR, STRIPPED_DIR, LOGS_DIR);

  const groups = getProcessableGroups({
    dataPath: DATA_PATH,
    rescan,
    limit,
    svgDir: SVG_DIR,
  });
  console.log(`${groups.length} URLs to process\n`);

  const log: FetchLogEntry[] = [];
  let cachedCount = 0;
  let fetchedCount = 0;
  let errorCount = 0;

  for (let i = 0; i < groups.length; i++) {
    const { url, entries } = groups[i];
    const cacheFile = `${urlToFilename(url)}.html`;
    const cachePath = path.join(CACHE_DIR, cacheFile);
    const strippedPath = path.join(STRIPPED_DIR, cacheFile);

    const models = entries.map((entry) => entry.model);
    console.log(`[${i + 1}/${groups.length}] ${url}`);
    console.log(`  Models: ${models.join(", ")}`);

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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`  ✗ ${message}\n`);
      log.push({ url, cacheFile, status: "error", error: message });
      errorCount++;
    }

    if (i < groups.length - 1) {
      await sleep(1500);
    }
  }

  const logPath = path.join(LOGS_DIR, `pelican-fetch-${Date.now()}.json`);
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2));

  console.log("-".repeat(50));
  console.log(
    `Fetch done. Cached: ${cachedCount}, Fetched: ${fetchedCount}, Errors: ${errorCount}`,
  );
  console.log(`Log: ${logPath}\n`);

  return log;
}

async function phaseExtract() {
  console.log("═══ Phase 2: Extract SVGs via LLM ═══\n");
  if (rescan) {
    console.log("  (rescan mode — re-processing all entries)\n");
  }

  const { chatCompletion } = await import("./shared/openrouter-client");

  ensureDirs(CACHE_DIR, STRIPPED_DIR, LOGS_DIR);

  const groups = getProcessableGroups({
    dataPath: DATA_PATH,
    rescan,
    limit,
    svgDir: SVG_DIR,
  });

  const processable = groups.filter((group) => {
    const strippedPath = path.join(STRIPPED_DIR, `${urlToFilename(group.url)}.html`);
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
    const cacheFile = `${urlToFilename(url)}.html`;
    const strippedPath = path.join(STRIPPED_DIR, cacheFile);
    const models = entries.map((entry) => entry.model);

    console.log(`[${i + 1}/${processable.length}] ${url}`);
    console.log(`  Models: ${models.join(", ")}`);

    let html = fs.readFileSync(strippedPath, "utf-8");

    const maxChars = 120_000;
    if (html.length > maxChars) {
      console.log(`  ⚠ Truncating: ${html.length} → ${maxChars} chars`);
      html = `${html.slice(0, maxChars)}\n[TRUNCATED]`;
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
        const allNotFound = extractions.every((extraction) => extraction.type === "not_found");

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
          if (extraction.type === "not_found") {
            continue;
          }

          if (extraction.type === "svg") {
            const filename = makeImageFilename(entry.model, entry.date, imgIndex, ".svg");
            if (dryRun) {
              console.log(
                `  ✓ ${entry.model} [${imgIndex + 1}]: SVG ${extraction.content.length} chars (dry-run) → ${filename}`,
              );
            } else {
              fs.writeFileSync(path.join(SVG_DIR, filename), extraction.content, "utf-8");
              console.log(
                `  ✓ ${entry.model} [${imgIndex + 1}]: SVG ${extraction.content.length} chars → ${filename}`,
              );
            }
            savedFiles.push(filename);
            imgIndex++;
            continue;
          }

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
            console.log(
              `  ✓ ${entry.model} [${imgIndex + 1}]: SVG ${fetched.content.length} chars → ${filename}`,
            );
            savedFiles.push(filename);
          } else {
            const rasterFilename = makeImageFilename(entry.model, entry.date, imgIndex, fetched.ext);
            const placeholderSvg = makeImageFilename(entry.model, entry.date, imgIndex, ".svg");

            if (!dryRun) {
              fs.writeFileSync(path.join(SVG_DIR, rasterFilename), fetched.data);
              const placeholderPath = path.join(SVG_DIR, placeholderSvg);
              if (!fs.existsSync(placeholderPath)) {
                fs.writeFileSync(placeholderPath, buildPlaceholderSvg(entry.model), "utf-8");
                console.log(`  📄 Created placeholder: ${placeholderSvg}`);
              }
            }

            console.log(
              `  ✓ ${entry.model} [${imgIndex + 1}]: ${fetched.ext} ${fetched.data.length} bytes → ${rasterFilename}`,
            );
            savedFiles.push(placeholderSvg);
          }

          imgIndex++;
        }

        if (savedFiles.length > 0) {
          const dataEntry = data.entries.find(
            (candidate) => candidate.model === entry.model && candidate.date === entry.date,
          );

          if (dataEntry) {
            const before = dataEntry.svg_files.length;
            dataEntry.svg_files = savedFiles;
            const added = savedFiles.length - before;
            if (added > 0) {
              newImagesCount += added;
            }
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`  ✗ LLM error: ${message}`);
      log.push({
        url,
        models,
        cacheFile,
        promptLength: 0,
        responseLength: 0,
        prompt: "",
        response: "",
        results: entries.map((entry) => ({
          model: entry.model,
          files: entry.svg_files,
          status: "not_found" as const,
        })),
      });
      errorCount++;
    }

    console.log();
    if (i < processable.length - 1) {
      await sleep(2000);
    }
  }

  if (!dryRun) {
    fs.writeFileSync(DATA_PATH, `${JSON.stringify(data, null, 2)}\n`);
    console.log(`Updated ${DATA_PATH}`);
  }

  const logPath = path.join(LOGS_DIR, `pelican-extract-${Date.now()}.json`);
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2));

  console.log("-".repeat(50));
  console.log(`Extract done. URLs: ${successCount}, Errors: ${errorCount}, New images: ${newImagesCount}`);
  console.log(`Log: ${logPath}`);
}

async function main() {
  if (!["fetch", "extract", "all"].includes(command)) {
    console.error(`Unknown command: ${command}`);
    console.error("Usage: pnpm exec tsx scripts/fetch-pelican-svgs.ts <fetch|extract|all> [--limit N] [--dry-run] [--rescan]");
    process.exit(1);
  }

  if (command === "fetch" || command === "all") {
    await phaseFetch();
  }

  if (command === "extract" || command === "all") {
    await phaseExtract();
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
