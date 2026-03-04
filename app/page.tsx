import { Suspense } from "react";

import { TimelineExperience } from "@/components/timeline/timeline-experience";
import { getTimelineEvents, getSvgContents, getRasterFallbacks } from "@/lib/timeline";

export default function HomePage() {
  const events = getTimelineEvents();
  const svgContents = getSvgContents();
  const rasterFallbacks = getRasterFallbacks();

  return (
    <Suspense>
      <TimelineExperience events={events} svgContents={svgContents} rasterFallbacks={rasterFallbacks} />
    </Suspense>
  );
}
