import type { RawEvent, SourceTimeline } from "./shared/raw-event-schema.js";
import { rawEventSchema } from "./shared/raw-event-schema.js";
import {
  chatCompletion,
  type OpenRouterConfig,
} from "./shared/openrouter-client.js";
import { z } from "zod";

function getExistingNames(data: SourceTimeline): {
  organizations: string[];
  modelFamilies: string[];
} {
  const allEvents = [
    ...data.context_before_2025,
    ...data.months.flatMap((m) => m.events),
  ];

  return {
    organizations: [...new Set(allEvents.map((e) => e.organization))].sort(),
    modelFamilies: [...new Set(allEvents.map((e) => e.model_family))].sort(),
  };
}

function buildSystemPrompt(
  existingOrganizations: string[],
  existingModelFamilies: string[],
  impactLegend: Record<string, string>,
): string {
  const exampleEvent = {
    date: "2025-01-20",
    date_precision: "day",
    title: "DeepSeek-R1 released (reasoning model, open weights)",
    organization: "DeepSeek",
    model_family: "DeepSeek-R1",
    modalities: ["text"],
    release_type: "open-weights",
    description:
      "DeepSeek released R1 as a reasoning-focused model and also published distilled smaller models, emphasizing permissive use and community re-use.",
    why_it_mattered:
      "This was quickly framed as a 'DeepSeek moment'—a strong open-weights reasoning release that pushed global conversation about cost/performance and open ecosystems.",
    network_impact: {
      level: "watershed",
      markers: [
        "open-weights",
        "reasoning",
        "community-forks",
        "narrative-shift",
      ],
    },
    sources: [
      {
        label: "DeepSeek — DeepSeek-R1 release",
        url: "https://api-docs.deepseek.com/news/news250120",
      },
    ],
  };

  return `You are an AI timeline curator. You read daily AI newsletters and extract structured event data about AI model releases and milestones.

## Your Task
Read the newsletter content below and extract ONLY events about:
- New AI model releases (open-weights, closed/API, research preview)
- Major model version upgrades
- Significant model capability announcements (e.g., new modality support, major architecture changes)

Do NOT extract:
- Product feature updates (unless tied to a new model release)
- Business/funding news
- Regulatory news
- Minor patches, bug fixes, or region-limited experiments
- Tool/platform updates that are not model releases

## Output Format
Return a JSON object with a single key "events" containing an array of event objects.
Each event MUST match this exact schema:

{
  "date": "YYYY-MM-DD",
  "date_precision": "day",
  "title": "Model Name released (brief descriptor)",
  "organization": "Company Name",
  "model_family": "Model-Family",
  "modalities": ["text"],
  "release_type": "open-weights",
  "description": "One paragraph factual description of the release.",
  "why_it_mattered": "One paragraph explaining significance and downstream effects.",
  "network_impact": {
    "level": "high",
    "markers": ["tag1", "tag2"]
  },
  "sources": [
    {"label": "Source Name — Article title", "url": "https://..."}
  ]
}

## Field Guidelines
- date: Use the most precise date available from the newsletter. Format: YYYY-MM-DD
- date_precision: Almost always "day". Use "month" only if exact day is unknown.
- title: Format as "ModelName released/announced (brief qualifier)". Keep under 80 chars.
- organization: Use consistent names. Known organizations: ${existingOrganizations.join(", ")}
- model_family: The model series name. Known families: ${existingModelFamilies.join(", ")}
- modalities: Array from: "text", "image", "audio", "video", "pdf", "code"
- release_type: One of: "open-weights", "closed", "api", "closed+api", "research-preview"
- description: 1-2 sentences, factual, what was released and key technical details.
- why_it_mattered: 1-2 sentences, significance, competitive context, community reaction.
- network_impact.level: One of: "watershed", "high", "medium", "low"
- network_impact.markers: 2-4 kebab-case tags. Examples: "open-weights", "reasoning", "multimodal", "narrative-shift", "benchmark-leader", "architecture-innovation"
- sources: Include URLs found in the newsletter. Label format: "Org — Description"

## Impact Level Guide
${JSON.stringify(impactLegend, null, 2)}

## Example Event
${JSON.stringify(exampleEvent, null, 2)}

## Important Rules
1. Only extract events that represent genuine model releases or major upgrades.
2. If no relevant model events are found, return: {"events": []}
3. Be conservative with "watershed" — only for truly industry-shifting moments.
4. Use existing organization/model family names when possible for consistency.
5. Every event MUST have at least one source URL.
6. Write in English regardless of the newsletter language.`;
}

export async function extractEventsFromNewsletter(
  newsletterHtml: string,
  newsletterDate: string,
  config: OpenRouterConfig,
  existingData: SourceTimeline,
): Promise<{
  events: RawEvent[];
  rawResponse: string;
  skippedCount: number;
}> {
  const { organizations, modelFamilies } = getExistingNames(existingData);

  const systemPrompt = buildSystemPrompt(
    organizations,
    modelFamilies,
    existingData.impact_legend,
  );

  const userMessage = `Newsletter date: ${newsletterDate}

Newsletter content:
${newsletterHtml}`;

  const rawResponse = await chatCompletion(config, [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ], {
    temperature: 0.2,
    responseFormat: { type: "json_object" },
  });

  // Parse LLM response
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawResponse);
  } catch {
    console.error("Failed to parse LLM response as JSON:", rawResponse);
    return { events: [], rawResponse, skippedCount: 0 };
  }

  const responseSchema = z.object({
    events: z.array(z.unknown()),
  });

  const envelope = responseSchema.safeParse(parsed);
  if (!envelope.success) {
    console.error("LLM response missing 'events' array:", parsed);
    return { events: [], rawResponse, skippedCount: 0 };
  }

  // Validate each event individually
  const validEvents: RawEvent[] = [];
  let skippedCount = 0;

  for (const rawEvent of envelope.data.events) {
    const result = rawEventSchema.safeParse(rawEvent);
    if (result.success) {
      validEvents.push(result.data);
    } else {
      skippedCount++;
      console.warn(
        "Skipping invalid event:",
        JSON.stringify(rawEvent, null, 2),
      );
      console.warn("Validation errors:", result.error.message);
    }
  }

  return { events: validEvents, rawResponse, skippedCount };
}
