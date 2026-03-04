"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { TimelineEvent } from "@/lib/timeline-schema";
import { formatEventDateShort } from "@/lib/timeline-utils";

type TimelineItemProps = {
  event: TimelineEvent;
  index: number;
  svgContents: Record<string, string>;
  rasterFallbacks: Record<string, string>;
};

function isRealSvg(content: string): boolean {
  return !content.includes("placeholder");
}

export function TimelineItem({ event, index, svgContents, rasterFallbacks }: TimelineItemProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLLIElement>(null);

  const toggle = useCallback(() => setOpen((prev) => !prev), []);

  useEffect(() => {
    if (!open) return;

    requestAnimationFrame(() => {
      ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });

    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [open]);

  const files = event.svgFiles ?? [];

  return (
    <li
      id={`event-${event.id}`}
      ref={ref}
      className={`timeline-item${event.significance === "high" ? " is-key" : ""}${open ? " is-open" : ""}`}
      style={{ "--i": index } as React.CSSProperties}
      onClick={toggle}
    >
      <span className="timeline-bar" aria-hidden="true" />

      <div className="timeline-text">
        <div className="timeline-header">
          <span className="timeline-date">
            {formatEventDateShort(event.date, event.datePrecision)}
          </span>
          <span className="timeline-title">{event.title}</span>
          <span className="timeline-org">{event.organization}</span>

          <div className="timeline-tooltip" role="tooltip">
            <p className="tooltip-summary">{event.summary}</p>
            <p className="tooltip-details">{event.detail}</p>
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
        </div>

        {files.map((file) => {
          const svg = svgContents[file];
          const raster = rasterFallbacks[file];

          if (svg && isRealSvg(svg)) {
            return (
              <div
                key={file}
                className="pelican-svg-frame"
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            );
          }

          if (raster) {
            return (
              <div key={file} className="pelican-svg-frame">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={raster} alt={`${event.title} pelican drawing`} />
              </div>
            );
          }

          return null;
        })}
      </div>
    </li>
  );
}
