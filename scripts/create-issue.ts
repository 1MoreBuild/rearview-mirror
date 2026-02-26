import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import type { RawEvent } from "./shared/raw-event-schema.js";

function formatImpactBadge(level: string): string {
  const badges: Record<string, string> = {
    watershed: "watershed",
    high: "high",
    medium: "medium",
    low: "low",
  };
  return badges[level] ?? level;
}

function buildIssueBody(
  events: RawEvent[],
  newsletterDate: string,
  newsletterTitle: string,
  newsletterLink: string,
): string {
  // Summary table
  const tableRows = events
    .map((e, i) => {
      const num = i + 1;
      return `| ${num} | ${e.date} | ${e.title} | ${e.organization} | ${formatImpactBadge(e.network_impact.level)} | ${e.release_type} |`;
    })
    .join("\n");

  // Detailed event descriptions
  const details = events
    .map((e, i) => {
      const num = i + 1;
      const sources = e.sources
        .map((s) => `- [${s.label}](${s.url})`)
        .join("\n");
      return `#### ${num}. ${e.title}
- **Organization**: ${e.organization}
- **Model Family**: ${e.model_family}
- **Date**: ${e.date}
- **Modalities**: ${e.modalities.join(", ")}
- **Release Type**: ${e.release_type}
- **Impact**: ${formatImpactBadge(e.network_impact.level)}
- **Markers**: ${e.network_impact.markers.join(", ")}
- **Description**: ${e.description}
- **Why it mattered**: ${e.why_it_mattered}
- **Sources**:
${sources}`;
    })
    .join("\n\n---\n\n");

  const eventsJson = JSON.stringify(events, null, 2);

  return `## AI Timeline Candidates - ${newsletterDate}

Source: [${newsletterTitle}](${newsletterLink})

### Extracted Events (${events.length} found)

| # | Date | Title | Organization | Impact | Release Type |
|---|------|-------|-------------|--------|--------------|
${tableRows}

### Event Details

${details}

---

### Review Instructions

1. Review each event above for accuracy
2. Edit the JSON below to correct any errors, remove unwanted events, or adjust impact levels
3. Add the \`approved\` label when ready to create a PR

<details>
<summary>Machine-readable JSON (edit if needed)</summary>

<!-- EVENTS_JSON_START -->
\`\`\`json
${eventsJson}
\`\`\`
<!-- EVENTS_JSON_END -->

</details>`;
}

export function createCandidateIssue(
  events: RawEvent[],
  newsletterDate: string,
  newsletterTitle: string,
  newsletterLink: string,
): { issueNumber: number; issueUrl: string } {
  const title = `AI Timeline: New events from ${newsletterDate}`;
  const body = buildIssueBody(
    events,
    newsletterDate,
    newsletterTitle,
    newsletterLink,
  );

  // Write body to a temp file to avoid shell escaping issues
  const tmpFile = `/tmp/issue-body-${Date.now()}.md`;
  writeFileSync(tmpFile, body, "utf-8");

  try {
    const result = execSync(
      `gh issue create --title "${title}" --label "ai-timeline-candidate" --body-file "${tmpFile}"`,
      { encoding: "utf-8", timeout: 30000 },
    ).trim();

    // gh issue create returns the issue URL
    const issueUrl = result;
    const issueNumber = parseInt(issueUrl.split("/").pop() ?? "0", 10);

    return { issueNumber, issueUrl };
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch {
      // ignore cleanup errors
    }
  }
}
