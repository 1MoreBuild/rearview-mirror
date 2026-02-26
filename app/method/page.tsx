import { getTimelineMeta } from "@/lib/timeline";

export default function MethodPage() {
  const meta = getTimelineMeta();

  return (
    <div className="site-content">
    <main className="page-shell static-page">
      <h1>Method</h1>

      <h2>Dataset coverage</h2>
      <ul>
        <li>Primary range: {meta.rangeStart} to {meta.rangeEnd}.</li>
        <li>
          Current dataset snapshot: {meta.asOf}, {meta.totalEvents} total events.
        </li>
      </ul>

      <h2>Inclusion criteria</h2>
      <ul>
        <li>Major model launch or major version transition.</li>
        <li>Release that changed adoption patterns, workflows, or defaults.</li>
        <li>Open-weights drops with clear ecosystem impact.</li>
        <li>Significant product launches or engineering milestones.</li>
      </ul>

      <h2>Significance levels</h2>
      <ul>
        <li>
          <code>high</code> — widely discussed and/or quickly adopted; strong
          downstream effects. Highlighted as key moments in the timeline.
        </li>
        <li>
          <code>low</code> — important but narrower spread or limited rollout.
        </li>
        <li>Current highlighted events: {meta.highSignificanceCount}.</li>
      </ul>

      <h2>Known limitations</h2>
      <ul>
        <li>No automatic scraping pipeline in v1.</li>
        <li>No CMS backend in v1.</li>
        <li>English-first content baseline.</li>
      </ul>
    </main>
    </div>
  );
}
