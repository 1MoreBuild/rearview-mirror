import type { TimelineEvent } from "@/lib/timeline-schema";
import { getEventMonthGroup } from "@/lib/timeline-utils";

import { TimelineItem } from "@/components/timeline/timeline-item";
import {
  buildEventViewerImages,
  type TimelineViewerImage,
  type TimelineViewerImageForEvent,
} from "@/components/timeline/timeline-viewer-images";

export type MonthGroup = {
  label: string;
  events: TimelineEvent[];
};

export function groupByMonth(events: TimelineEvent[]): MonthGroup[] {
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
  svgContents: Record<string, string>;
  rasterFallbacks: Record<string, string>;
};

export function TimelineList({ groups, svgContents, rasterFallbacks }: TimelineListProps) {
  if (!groups.length) {
    return (
      <section className="timeline-empty" aria-live="polite">
        <p>No events match this filter set.</p>
      </section>
    );
  }

  const allViewerImages: TimelineViewerImage[] = [];
  const eventImagesById = new Map<string, TimelineViewerImageForEvent[]>();

  for (const group of groups) {
    for (const event of group.events) {
      const eventImages = buildEventViewerImages(event, svgContents, rasterFallbacks);
      const eventImagesWithGlobalIndex = eventImages.map((image, imageOffset) => ({
        ...image,
        globalIndex: allViewerImages.length + imageOffset,
      }));

      allViewerImages.push(...eventImages);
      eventImagesById.set(event.id, eventImagesWithGlobalIndex);
    }
  }

  const groupsWithStartIndex = groups.reduce<
    Array<{
      group: MonthGroup;
      startIndex: number;
    }>
  >((acc, group) => {
    const previous = acc[acc.length - 1];
    const startIndex = previous
      ? previous.startIndex + previous.group.events.length
      : 0;
    return [...acc, { group, startIndex }];
  }, []);

  return (
    <div className="timeline-list">
      {groupsWithStartIndex.map(({ group, startIndex }) => {
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
                  eventImages={eventImagesById.get(event.id) ?? []}
                  allViewerImages={allViewerImages}
                />
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
