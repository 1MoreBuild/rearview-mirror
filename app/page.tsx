import { Suspense } from "react";

import { TimelineExperience } from "@/components/timeline/timeline-experience";
import { getTimelineEvents, getSvgContents, getRasterFallbacks } from "@/lib/timeline";

type PageSearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function HomePage({
  searchParams,
}: {
  searchParams?: Promise<PageSearchParams>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const events = getTimelineEvents();
  const svgContents = getSvgContents();
  const rasterFallbacks = getRasterFallbacks();
  const initialParams = {
    category: firstValue(resolvedSearchParams.category),
    density: firstValue(resolvedSearchParams.density),
    q: firstValue(resolvedSearchParams.q),
    year: firstValue(resolvedSearchParams.year),
    org: firstValue(resolvedSearchParams.org),
  };

  return (
    <Suspense>
      <TimelineExperience
        events={events}
        svgContents={svgContents}
        rasterFallbacks={rasterFallbacks}
        initialParams={initialParams}
      />
    </Suspense>
  );
}
