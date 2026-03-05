import { describe, expect, it } from "vitest";

import {
  discoverPosts,
  extractImageUrls,
  looksLikeModelName,
  normalizeModel,
} from "../scripts/sync-pelican-from-tag";

describe("sync-pelican-from-tag", () => {
  it("accepts model-family names with inline versions", () => {
    expect(looksLikeModelName("Qwen3.5")).toBe(true);
    expect(looksLikeModelName("GPT5.1")).toBe(true);
  });

  it("keeps only images that belong to the current model", () => {
    const html = `
<div class="blogmark segment" data-type="blogmark" data-id="1">
  <p><strong><a href="https://openai.com/index/introducing-gpt-5-3-codex-spark/">Introducing GPT-5.3-Codex-Spark</a></strong>.</p>
  <p><img src="https://static.simonwillison.net/static/2026/gpt-5.3-codex-spark-pelican.png" alt="Spark pelican" /></p>
  <p><img src="https://static.simonwillison.net/static/2026/gpt-5.3-codex-pelican.png" alt="Previous codex pelican" /></p>
  <p class="date-and-tags">
    <a href="/2026/Feb/10/gpt-53-codex-spark/" rel="bookmark">#</a>
    / <a href="/tags/openai/">openai</a>, <a href="/tags/llm-release/">llm-release</a>
  </p>
</div>
`;

    const posts = discoverPosts(html);
    expect(posts).toHaveLength(1);
    expect(posts[0].model).toBe("GPT-5.3-Codex-Spark");
    expect(posts[0].imageUrls).toEqual([
      "https://static.simonwillison.net/static/2026/gpt-5.3-codex-spark-pelican.png",
    ]);
  });

  it('trims "Introducing the" prefix fully', () => {
    expect(normalizeModel("Introducing the Gemini 3.1 Flash-Lite")).toBe(
      "Gemini 3.1 Flash-Lite",
    );
  });

  it("keeps o1/o3/o4 model-family tokens intact for image filtering", () => {
    const segment = `
<div class="blogmark segment">
  <p><img src="https://static.simonwillison.net/static/2026/o3-pro-pelican.png" alt="o3-pro pelican" /></p>
  <p><img src="https://static.simonwillison.net/static/2026/o4-mini-pelican.png" alt="o4-mini pelican" /></p>
</div>
`;

    expect(extractImageUrls(segment, "o3-pro")).toEqual([
      "https://static.simonwillison.net/static/2026/o3-pro-pelican.png",
    ]);
  });
});
