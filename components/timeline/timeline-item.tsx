"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ModelTimelineEvent } from "@/lib/timeline-schema";
import { formatEventDateShort } from "@/lib/timeline-utils";

type TimelineItemProps = {
  event: ModelTimelineEvent;
  index: number;
};

export function TimelineItem({ event, index }: TimelineItemProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLLIElement>(null);

  const toggle = useCallback(() => setOpen((prev) => !prev), []);

  useEffect(() => {
    if (!open) return;

    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [open]);

  return (
    <li
      id={`event-${event.id}`}
      ref={ref}
      className={`timeline-item${event.isKeyMoment ? " is-key" : ""}${open ? " is-open" : ""}`}
      style={{ "--i": index } as React.CSSProperties}
      onClick={toggle}
    >
      <span className="timeline-bar" aria-hidden="true" />

      <div className="timeline-text">
        <span className="timeline-date">
          {formatEventDateShort(event.date, event.datePrecision)}
        </span>
        <span className="timeline-title">{event.title}</span>
        <span className="timeline-org">{event.organization}</span>
      </div>

      <div className="timeline-tooltip" role="tooltip">
        <p className="tooltip-summary">{event.summary}</p>
        <p className="tooltip-details">{event.details}</p>
        <ul className="tooltip-sources">
          {event.sources.map((source) => (
            <li key={source.url}>
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                {source.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}
