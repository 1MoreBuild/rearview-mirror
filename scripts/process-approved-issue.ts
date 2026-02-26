import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { z } from "zod";
import { rawEventSchema, type RawEvent } from "./shared/raw-event-schema.js";
import {
  findCurrentDataFile,
  readDataFile,
  insertEvents,
  getDataFileName,
  getAllExistingEvents,
} from "./shared/data-file-utils.js";
import { deduplicateEvents } from "./shared/dedup.js";

function exec(cmd: string): string {
  return execSync(cmd, { encoding: "utf-8", timeout: 30000 }).trim();
}

function extractJsonFromIssueBody(body: string): RawEvent[] {
  const startMarker = "<!-- EVENTS_JSON_START -->";
  const endMarker = "<!-- EVENTS_JSON_END -->";

  const startIdx = body.indexOf(startMarker);
  const endIdx = body.indexOf(endMarker);

  if (startIdx === -1 || endIdx === -1) {
    throw new Error(
      "Could not find EVENTS_JSON markers in issue body. Was the issue created by the pipeline?",
    );
  }

  const jsonBlock = body.substring(startIdx + startMarker.length, endIdx);

  // Extract JSON from markdown code block
  const codeBlockMatch = jsonBlock.match(/```json?\s*([\s\S]*?)```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : jsonBlock.trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error(`Failed to parse events JSON: ${e}`);
  }

  const eventsArray = z.array(z.unknown()).parse(parsed);
  const validEvents: RawEvent[] = [];

  for (const raw of eventsArray) {
    const result = rawEventSchema.safeParse(raw);
    if (result.success) {
      validEvents.push(result.data);
    } else {
      console.warn("Skipping invalid event in approved issue:", result.error.message);
    }
  }

  return validEvents;
}

function updateTimelineImport(
  timelineTsPath: string,
  oldFileName: string,
  newFileName: string,
): void {
  if (oldFileName === newFileName) return;

  const content = readFileSync(timelineTsPath, "utf-8");
  const updated = content.replace(
    `@/data/${oldFileName}`,
    `@/data/${newFileName}`,
  );

  if (content === updated) {
    console.warn(
      `Warning: Could not find import for ${oldFileName} in ${timelineTsPath}`,
    );
    return;
  }

  writeFileSync(timelineTsPath, updated, "utf-8");
  console.log(`Updated import in ${timelineTsPath}: ${oldFileName} → ${newFileName}`);
}

async function main(): Promise<void> {
  const issueNumber = process.env.ISSUE_NUMBER;
  if (!issueNumber) {
    throw new Error("Missing ISSUE_NUMBER environment variable");
  }

  console.log(`Processing approved issue #${issueNumber}...`);

  // 1. Fetch issue body
  const issueBody = exec(
    `gh issue view ${issueNumber} --json body --jq .body`,
  );

  // 2. Extract events from issue
  const approvedEvents = extractJsonFromIssueBody(issueBody);
  console.log(`Found ${approvedEvents.length} approved event(s)`);

  if (approvedEvents.length === 0) {
    console.log("No valid events found. Closing without changes.");
    exec(
      `gh issue comment ${issueNumber} --body "No valid events found in the JSON block. No changes made."`,
    );
    return;
  }

  // 3. Read current data file
  const currentDataPath = findCurrentDataFile("data/");
  const currentData = readDataFile(currentDataPath);
  const currentFileName = currentDataPath.split("/").pop()!;

  // 4. Deduplicate
  const existingEvents = getAllExistingEvents(currentData);
  const uniqueEvents = deduplicateEvents(approvedEvents, existingEvents);
  console.log(
    `After dedup: ${uniqueEvents.length} new event(s) (${approvedEvents.length - uniqueEvents.length} duplicates)`,
  );

  if (uniqueEvents.length === 0) {
    console.log("All events already exist. Closing without changes.");
    exec(
      `gh issue comment ${issueNumber} --body "All events already exist in the timeline. No changes made."`,
    );
    return;
  }

  // 5. Insert events
  const updatedData = insertEvents(currentData, uniqueEvents);
  const newFileName = getDataFileName(updatedData);

  // 6. Create branch and apply changes
  const branchName = `ai-timeline/issue-${issueNumber}`;
  exec(`git checkout -b ${branchName}`);

  // Write updated data
  const newDataPath = `data/${newFileName}`;
  const json = JSON.stringify(updatedData, null, 2) + "\n";
  writeFileSync(newDataPath, json, "utf-8");

  // Handle file rename if needed
  if (currentFileName !== newFileName) {
    exec(`git rm "data/${currentFileName}"`);
    updateTimelineImport("lib/timeline.ts", currentFileName, newFileName);
  }

  // 7. Commit and push
  exec(`git add data/ lib/timeline.ts`);

  const eventTitles = uniqueEvents
    .map((e) => `- ${e.title}`)
    .join("\n");
  const commitMsg = `feat: add ${uniqueEvents.length} AI timeline event(s) from issue #${issueNumber}\n\n${eventTitles}`;

  exec(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`);
  exec(`git push -u origin ${branchName}`);

  // 8. Create PR
  const prBody = `## AI Timeline Update

Adds ${uniqueEvents.length} event(s) from issue #${issueNumber}.

### Events Added
${eventTitles}

Closes #${issueNumber}`;

  const tmpPrBody = `/tmp/pr-body-${Date.now()}.md`;
  writeFileSync(tmpPrBody, prBody, "utf-8");

  try {
    const prUrl = exec(
      `gh pr create --title "feat: add AI timeline events from #${issueNumber}" --body-file "${tmpPrBody}"`,
    );
    console.log(`Created PR: ${prUrl}`);

    // Comment on the issue with the PR link
    exec(
      `gh issue comment ${issueNumber} --body "PR created: ${prUrl}"`,
    );
  } finally {
    try {
      unlinkSync(tmpPrBody);
    } catch {
      // ignore
    }
  }
}

main().catch((error) => {
  console.error("Processing failed:", error);
  process.exit(1);
});
