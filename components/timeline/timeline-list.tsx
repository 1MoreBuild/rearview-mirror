import type { ModelTimelineEvent } from "@/lib/timeline-schema";
import { getEventMonthGroup } from "@/lib/timeline-utils";

import { TimelineItem } from "@/components/timeline/timeline-item";

export type MonthGroup = {
  label: string;
  events: ModelTimelineEvent[];
};

export function groupByMonth(events: ModelTimelineEvent[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  let current: MonthGroup | null = null;

  for (const event of events) {
    const label = getEventMonthGroup(event.date, event.datePrecision);

    if (!current || current.label !== label) {
      current = { label, events: [] };
      groups.push(current);
    }

    current.events.push(event);
  }

  return groups;
}

type TimelineListProps = {
  groups: MonthGroup[];
};

export function TimelineList({ groups }: TimelineListProps) {
  if (!groups.length) {
    return (
      <section className="timeline-empty" aria-live="polite">
        <p>No events match this filter set.</p>
      </section>
    );
  }

  let runningIndex = 0;

  return (
    <div className="timeline-list">
      {groups.map((group) => {
        const startIndex = runningIndex;
        runningIndex += group.events.length;

        return (
          <section key={group.label} className="timeline-group" data-month={group.label}>
            <div className="timeline-month-header">
              <span>{group.label}</span>
            </div>
            <ol className="timeline-group-items">
              {group.events.map((event, i) => (
                <TimelineItem
                  key={event.id}
                  event={event}
                  index={startIndex + i}
                />
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
