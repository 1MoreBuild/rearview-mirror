import type { ModelTimelineEvent } from "@/lib/timeline-schema";

import { TimelineItem } from "@/components/timeline/timeline-item";

type TimelineListProps = {
  events: ModelTimelineEvent[];
};

export function TimelineList({ events }: TimelineListProps) {
  if (!events.length) {
    return (
      <section className="timeline-empty" aria-live="polite">
        <p>No events match this filter set.</p>
      </section>
    );
  }

  return (
    <ol className="timeline-list">
      {events.map((event) => (
        <TimelineItem key={event.id} event={event} />
      ))}
    </ol>
  );
}
