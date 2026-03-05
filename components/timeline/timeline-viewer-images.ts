import type { TimelineEvent } from "@/lib/timeline-schema";
import { formatEventDate } from "@/lib/timeline-utils";

export type TimelineViewerImage = {
  key: string;
  eventId: string;
  eventDateLabel: string;
  eventTitle: string;
  eventOrganization: string;
  file: string;
  kind: "svg" | "raster";
  alt: string;
  svg?: string;
  src?: string;
};

export type TimelineViewerImageForEvent = TimelineViewerImage & {
  globalIndex: number;
};

function isRealSvg(content: string): boolean {
  return !content.includes("placeholder");
}

export function buildEventViewerImages(
  event: TimelineEvent,
  svgContents: Record<string, string>,
  rasterFallbacks: Record<string, string>,
): TimelineViewerImage[] {
  const files = event.svgFiles ?? [];
  const images: TimelineViewerImage[] = [];

  for (const [fileIndex, file] of files.entries()) {
    const svg = svgContents[file];
    const raster = rasterFallbacks[file];
    const key = `${event.id}:${file}:${fileIndex}`;
    const eventDateLabel = formatEventDate(event.date, event.datePrecision);
    const suffix = files.length > 1 ? ` ${fileIndex + 1}` : "";
    const alt = `${event.title} pelican drawing${suffix}`;

    if (svg && isRealSvg(svg)) {
      images.push({
        key,
        eventId: event.id,
        eventDateLabel,
        eventTitle: event.title,
        eventOrganization: event.organization,
        file,
        kind: "svg",
        alt,
        svg,
      });
      continue;
    }

    if (raster) {
      images.push({
        key,
        eventId: event.id,
        eventDateLabel,
        eventTitle: event.title,
        eventOrganization: event.organization,
        file,
        kind: "raster",
        alt,
        src: raster,
      });
    }
  }

  return images;
}
