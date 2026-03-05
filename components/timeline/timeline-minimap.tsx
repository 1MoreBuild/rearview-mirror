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

function parseCssSize(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getStickyOffset(): number {
  const rootStyles = getComputedStyle(document.documentElement);
  const cssHeaderHeight = parseCssSize(rootStyles.getPropertyValue("--header-h"));
  const cssFilterHeight = parseCssSize(rootStyles.getPropertyValue("--filter-bar-h"));
  const monthHeaderHeight =
    document.querySelector<HTMLElement>(".timeline-month-header")?.getBoundingClientRect().height ?? 0;

  return cssHeaderHeight + cssFilterHeight + monthHeaderHeight + 12;
}

function scrollToEvent(id: string) {
  const el = document.getElementById(`event-${id}`);
  if (!el) return;

  const top = el.getBoundingClientRect().top + window.scrollY - getStickyOffset();

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

  return (
    <nav className="minimap" aria-label="Timeline minimap">
      {groups.map((group, index) => {
        const year = extractYear(group.label);
        const previousYear =
          index === 0 ? "" : extractYear(groups[index - 1].label);
        const showYear = year !== previousYear;

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
                    className={`minimap-dot${event.significance === "high" ? " is-key" : ""}`}
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
