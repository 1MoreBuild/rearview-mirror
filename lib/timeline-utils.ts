import type {
  DatePrecision,
  TimelineCategory,
  TimelineEvent,
} from "@/lib/timeline-schema";

const YEAR_EXTRACTOR = /^\d{4}/;

export type Density = "all" | "highlights";

export type TimelineFilters = {
  query: string;
  year: string;
  density: Density;
  categories: TimelineCategory[];
  organizations: string[];
};

export function getEventYear(date: string): string {
  return YEAR_EXTRACTOR.exec(date)?.[0] ?? "Unknown";
}

function toSortableTimestamp(date: string, precision: DatePrecision): number {
  const [yearPart, monthPart, dayPart] = date.split("-").map(Number);

  const year = Number.isFinite(yearPart) ? yearPart : 0;
  const month =
    Number.isFinite(monthPart) && monthPart > 0
      ? monthPart
      : precision === "year"
        ? 12
        : 1;
  const day =
    Number.isFinite(dayPart) && dayPart > 0
      ? dayPart
      : precision === "day"
        ? 1
        : 31;

  return Date.UTC(year, month - 1, day);
}

export function sortEventsNewestFirst<T extends TimelineEvent>(events: T[]): T[] {
  return [...events].sort((left, right) => {
    const leftTimestamp = toSortableTimestamp(left.date, left.datePrecision);
    const rightTimestamp = toSortableTimestamp(right.date, right.datePrecision);

    return rightTimestamp - leftTimestamp;
  });
}

export function filterEvents<T extends TimelineEvent>(
  events: T[],
  filters: TimelineFilters,
): T[] {
  const normalizedQuery = filters.query.trim().toLowerCase();

  return events.filter((event) => {
    if (filters.year !== "all" && getEventYear(event.date) !== filters.year) {
      return false;
    }

    if (
      filters.density === "highlights" &&
      event.significance !== "high"
    ) {
      return false;
    }

    if (
      filters.categories.length > 0 &&
      !filters.categories.includes(event.category)
    ) {
      return false;
    }

    if (
      filters.organizations.length > 0 &&
      !filters.organizations.includes(event.organization)
    ) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    const haystack = [
      event.title,
      event.summary,
      event.organization,
      event.tags.join(" "),
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(normalizedQuery);
  });
}

export function getAvailableYears<T extends TimelineEvent>(events: T[]): string[] {
  const years = new Set(events.map((event) => getEventYear(event.date)));

  return [...years]
    .filter((year) => /^\d{4}$/.test(year))
    .sort((left, right) => Number(right) - Number(left));
}

export function getAvailableOrganizations<T extends TimelineEvent>(
  events: T[],
): string[] {
  const orgs = new Set(events.map((event) => event.organization));
  return [...orgs].sort();
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function getEventMonthGroup(date: string, precision: DatePrecision): string {
  if (precision === "year") {
    return date.slice(0, 4);
  }

  const [year, month] = date.split("-").map(Number);
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

export function formatEventDateShort(
  date: string,
  precision: DatePrecision,
): string {
  if (precision === "year") {
    return date.slice(0, 4);
  }

  if (precision === "month") {
    const parsed = new Date(`${date}-01T00:00:00Z`);
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      timeZone: "UTC",
    }).format(parsed);
  }

  const parsed = new Date(`${date}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

export function formatEventDate(
  date: string,
  precision: DatePrecision,
): string {
  if (precision === "year") {
    return date.slice(0, 4);
  }

  if (precision === "month") {
    const parsed = new Date(`${date}-01T00:00:00Z`);
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(parsed);
  }

  const parsed = new Date(`${date}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}
