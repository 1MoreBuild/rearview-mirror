import { getTimelineMeta } from "@/lib/timeline";

export default function AboutPage() {
  const meta = getTimelineMeta();

  return (
    <div className="site-content">
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
        The current dataset covers {meta.rangeStart} to {meta.rangeEnd}, with
        support for model, product, and engineering event categories.
      </p>
    </main>
    </div>
  );
}
