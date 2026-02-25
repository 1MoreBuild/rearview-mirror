"use client";

import { useEffect, useState } from "react";

import type { MonthGroup } from "@/components/timeline/timeline-list";

type TimelineMinimapProps = {
  groups: MonthGroup[];
};

function extractYear(label: string): string {
  const match = label.match(/\d{4}/);
  return match ? match[0] : label;
}

function shortMonth(label: string): string {
  const match = label.match(/^[A-Za-z]+/);
  return match ? match[0] : label;
}

function scrollToEvent(id: string) {
  const el = document.getElementById(`event-${id}`);
  if (!el) return;

  const headerOffset = 56 + 40; // sticky site header + sticky month header
  const top = el.getBoundingClientRect().top + window.scrollY - headerOffset;

  window.scrollTo({ top, behavior: "smooth" });
}

export function TimelineMinimap({ groups }: TimelineMinimapProps) {
  const [activeMonth, setActiveMonth] = useState<string>("");

  useEffect(() => {
    const sections = document.querySelectorAll<HTMLElement>("[data-month]");
    if (!sections.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const month = entry.target.getAttribute("data-month");
            if (month) setActiveMonth(month);
          }
        }
      },
      { rootMargin: "0px 0px -70% 0px" },
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [groups]);

  // Group months by year for year-label separators
  let lastYear = "";

  return (
    <nav className="minimap" aria-label="Timeline minimap">
      {groups.map((group) => {
        const year = extractYear(group.label);
        const showYear = year !== lastYear;
        lastYear = year;

        // If label is just a year (year-precision), use it as month label
        const monthLabel = /^\d{4}$/.test(group.label)
          ? group.label
          : shortMonth(group.label);

        return (
          <div key={group.label}>
            {showYear && <div className="minimap-year">{year}</div>}
            <div
              className={`minimap-row${activeMonth === group.label ? " is-active" : ""}`}
            >
              <span className="minimap-month-label">{monthLabel}</span>
              <span className="minimap-dots">
                {group.events.map((event) => (
                  <button
                    key={event.id}
                    className={`minimap-dot${event.isKeyMoment ? " is-key" : ""}`}
                    onClick={() => scrollToEvent(event.id)}
                    aria-label={event.title}
                    type="button"
                  />
                ))}
              </span>
            </div>
          </div>
        );
      })}
    </nav>
  );
}
