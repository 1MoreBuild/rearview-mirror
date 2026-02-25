"use client";

import { useState } from "react";

import type { ModelTimelineEvent } from "@/lib/timeline-schema";
import { formatEventDate } from "@/lib/timeline-utils";

const IMPACT_LABELS = {
  high: "High impact",
  medium: "Medium impact",
  low: "Low impact",
} as const;

type TimelineItemProps = {
  event: ModelTimelineEvent;
};

export function TimelineItem({ event }: TimelineItemProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <li className="timeline-item">
      <span
        aria-hidden="true"
        className={`timeline-marker${event.isKeyMoment ? " is-key" : ""}`}
      />

      <article className="timeline-card">
        <p className="timeline-date">
          {formatEventDate(event.date, event.datePrecision)}
        </p>
        <h2>{event.title}</h2>
        <p className="timeline-summary">{event.summary}</p>

        <div className="timeline-meta">
          <span className={`impact-chip impact-${event.impact}`}>
            {IMPACT_LABELS[event.impact]}
          </span>
          <span className="org-chip">{event.organization}</span>
        </div>

        <ul className="tag-list" aria-label="Tags">
          {event.tags.map((tag) => (
            <li key={tag}>{tag}</li>
          ))}
        </ul>

        <button
          type="button"
          className="read-more-button"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
        >
          {expanded ? "Collapse" : "Read more"}
        </button>

        {expanded ? (
          <div className="timeline-details">
            <p>{event.details}</p>
            <h3>Sources</h3>
            <ul>
              {event.sources.map((source) => (
                <li key={source.url}>
                  <a href={source.url} target="_blank" rel="noopener noreferrer">
                    {source.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </article>
    </li>
  );
}
