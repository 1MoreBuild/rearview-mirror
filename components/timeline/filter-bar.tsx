import type { ImpactFilter } from "@/lib/timeline-utils";

type FilterBarProps = {
  search: string;
  year: string;
  impact: ImpactFilter;
  years: string[];
  resultCount: number;
  totalCount: number;
  onSearchChange: (value: string) => void;
  onYearChange: (value: string) => void;
  onImpactChange: (value: ImpactFilter) => void;
};

export function FilterBar({
  search,
  year,
  impact,
  years,
  resultCount,
  totalCount,
  onSearchChange,
  onYearChange,
  onImpactChange,
}: FilterBarProps) {
  return (
    <section className="filter-bar" aria-label="Timeline filters">
      <label className="filter-control filter-search">
        <span>Search</span>
        <input
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search title, org, tags"
        />
      </label>

      <label className="filter-control">
        <span>Year</span>
        <select value={year} onChange={(event) => onYearChange(event.target.value)}>
          <option value="all">All years</option>
          {years.map((availableYear) => (
            <option key={availableYear} value={availableYear}>
              {availableYear}
            </option>
          ))}
        </select>
      </label>

      <label className="filter-control">
        <span>Impact</span>
        <select
          value={impact}
          onChange={(event) => onImpactChange(event.target.value as ImpactFilter)}
        >
          <option value="all">All impact</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </label>

      <p className="results-summary">
        Showing {resultCount} of {totalCount} events
      </p>
    </section>
  );
}
