import { getModelTimelineMeta } from "@/lib/timeline";

export default function MethodPage() {
  const meta = getModelTimelineMeta();

  return (
    <main className="page-shell static-page">
      <h1>Method</h1>
      <p>{meta.scopeNote}</p>

      <h2>Dataset coverage</h2>
      <ul>
        <li>Primary range: {meta.rangeStart} to {meta.rangeEndInclusive}.</li>
        <li>
          Includes pre-range context entries when they materially shape the 2025+
          narrative.
        </li>
        <li>
          Current dataset snapshot: {meta.asOf} ({meta.timezone}), {meta.totalEvents} total events.
        </li>
      </ul>

      <h2>Inclusion criteria</h2>
      <ul>
        <li>Major model launch or major version transition.</li>
        <li>Release that changed adoption patterns, workflows, or defaults.</li>
        <li>Open-weights drops with clear ecosystem impact.</li>
      </ul>

      <h2>Impact handling</h2>
      <ul>
        <li>
          Source levels include <code>watershed/high/medium/low</code>.
        </li>
        <li>
          UI keeps <code>high/medium/low</code> filters; <code>watershed</code> is
          mapped to <code>high</code> and highlighted as a red key moment.
        </li>
        <li>Current red key moments: {meta.keyMomentCount} events.</li>
      </ul>

      <h2>Known limitations</h2>
      <ul>
        <li>No automatic scraping pipeline in v1.</li>
        <li>No CMS backend in v1.</li>
        <li>English-first content baseline.</li>
      </ul>
    </main>
  );
}
