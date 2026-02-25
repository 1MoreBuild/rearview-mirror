import type { ModelTimelineEvent } from "@/lib/timeline-schema";
import { sortEventsNewestFirst } from "@/lib/timeline-utils";
import { groupByMonth, TimelineList } from "@/components/timeline/timeline-list";
import { TimelineMinimap } from "@/components/timeline/timeline-minimap";

type TimelineExperienceProps = {
  events: ModelTimelineEvent[];
};

export function TimelineExperience({ events }: TimelineExperienceProps) {
  const sortedEvents = sortEventsNewestFirst(events);
  const groups = groupByMonth(sortedEvents);

  return (
    <>
      <TimelineList groups={groups} />
      <TimelineMinimap groups={groups} />
    </>
  );
}
