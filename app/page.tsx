import { Suspense } from "react";

import { TimelineExperience } from "@/components/timeline/timeline-experience";
import { getModelEvents, getModelTimelineMeta } from "@/lib/timeline";

export default function HomePage() {
  const events = getModelEvents();
  const meta = getModelTimelineMeta();

  return (
    <main className="page-shell">
      <section className="hero-block">
        <p className="hero-kicker">Rearview Mirror / Model Timeline</p>
        <h1>AI model milestones after ChatGPT 3.5</h1>
        <p>
          A continuous vertical timeline focused on model launches, upgrades, and
          ecosystem-defining moments. Important milestones are marked in red;
          standard events stay white.
        </p>
        <p className="hero-meta">
          Source window: {meta.rangeStart} to {meta.rangeEndInclusive} (as of{" "}
          {meta.asOf}). Showing {meta.totalEvents} events.
        </p>
      </section>

      <Suspense
        fallback={
          <section className="timeline-empty" aria-live="polite">
            <p>Loading timeline...</p>
          </section>
        }
      >
        <TimelineExperience events={events} />
      </Suspense>
    </main>
  );
}
