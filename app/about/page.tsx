import { getModelTimelineMeta } from "@/lib/timeline";

export default function AboutPage() {
  const meta = getModelTimelineMeta();

  return (
    <main className="page-shell static-page">
      <h1>About Rearview Mirror</h1>
      <p>
        Rearview Mirror documents what actually happened in AI, starting from
        the ChatGPT 3.5 era in late 2022. The project focuses on historical
        grounding over long-range prediction.
      </p>
      <p>
        The goal is to make one thing visible: how fast model capabilities,
        product assumptions, and ecosystem narratives can shift within a short
        time window.
      </p>
      <p>
        v1 intentionally stays narrow: model timeline first, with structure
        that can expand to product and engineering tracks later. The current
        dataset focuses on {meta.rangeStart} to {meta.rangeEndInclusive}, plus
        pre-2025 context where needed.
      </p>
    </main>
  );
}
