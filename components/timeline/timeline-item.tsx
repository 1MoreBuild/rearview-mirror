"use client";

import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type TouchEvent as ReactTouchEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

import type { TimelineEvent } from "@/lib/timeline-schema";
import { formatEventDateShort } from "@/lib/timeline-utils";
import type {
  TimelineViewerImage,
  TimelineViewerImageForEvent,
} from "@/components/timeline/timeline-viewer-images";

type TimelineItemProps = {
  event: TimelineEvent;
  index: number;
  eventImages: TimelineViewerImageForEvent[];
  allViewerImages: TimelineViewerImage[];
};

type ViewerMotion = "next" | "prev" | null;

const SWIPE_THRESHOLD_PX = 60;

export function TimelineItem({ event, index, eventImages, allViewerImages }: TimelineItemProps) {
  const [open, setOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [viewerMotion, setViewerMotion] = useState<ViewerMotion>(null);
  const ref = useRef<HTMLLIElement>(null);

  const normalizedViewerIndex =
    viewerIndex === null || allViewerImages.length === 0
      ? null
      : ((viewerIndex % allViewerImages.length) + allViewerImages.length) % allViewerImages.length;
  const viewerOpen = normalizedViewerIndex !== null;
  const currentImage = normalizedViewerIndex !== null ? allViewerImages[normalizedViewerIndex] : null;

  const toggle = useCallback(() => setOpen((prev) => !prev), []);
  const closeViewer = useCallback(() => {
    setViewerIndex(null);
    setViewerMotion(null);
  }, []);

  const goPrev = useCallback(() => {
    setViewerMotion("prev");
    setViewerIndex((current) => {
      if (current === null || allViewerImages.length < 2) return current;
      const normalized =
        ((current % allViewerImages.length) + allViewerImages.length) % allViewerImages.length;
      return normalized === 0 ? allViewerImages.length - 1 : normalized - 1;
    });
  }, [allViewerImages.length]);

  const goNext = useCallback(() => {
    setViewerMotion("next");
    setViewerIndex((current) => {
      if (current === null || allViewerImages.length < 2) return current;
      const normalized =
        ((current % allViewerImages.length) + allViewerImages.length) % allViewerImages.length;
      return normalized === allViewerImages.length - 1 ? 0 : normalized + 1;
    });
  }, [allViewerImages.length]);

  const openViewerAt = useCallback((globalIndex: number, e: ReactMouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    setViewerMotion(null);
    setViewerIndex(globalIndex);
  }, []);

  useEffect(() => {
    if (!open) return;

    const frameId = requestAnimationFrame(() => {
      const element = ref.current;
      if (!element) return;

      const headerHeight =
        document.querySelector<HTMLElement>(".site-header")?.offsetHeight ?? 0;
      const filterBarHeight =
        document.querySelector<HTMLElement>(".filter-bar")?.offsetHeight ?? 0;
      const safeTopOffset = headerHeight + filterBarHeight + 12;
      const rect = element.getBoundingClientRect();
      const viewportHeight = window.innerHeight;

      const isAboveViewport = rect.top < safeTopOffset;
      const isBelowViewport = rect.bottom > viewportHeight - 12;

      if (!isAboveViewport && !isBelowViewport) {
        return;
      }

      const targetTop = window.scrollY + rect.top - safeTopOffset - 12;
      window.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
    });

    function handleClick(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("click", handleClick);
    return () => {
      cancelAnimationFrame(frameId);
      document.removeEventListener("click", handleClick);
    };
  }, [open]);

  useEffect(() => {
    if (!viewerOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeViewer();
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goPrev();
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        goNext();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [closeViewer, goNext, goPrev, viewerOpen]);

  const handleViewerBackdropClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.stopPropagation();
      if (event.target === event.currentTarget) {
        closeViewer();
      }
    },
    [closeViewer],
  );

  const handleViewerTouchStart = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
    (event.currentTarget as HTMLDivElement).dataset.touchStartX = String(
      event.changedTouches[0]?.clientX ?? 0,
    );
  }, []);

  const handleViewerTouchEnd = useCallback(
    (event: ReactTouchEvent<HTMLDivElement>) => {
      const touchArea = event.currentTarget as HTMLDivElement;
      const startXRaw = touchArea.dataset.touchStartX;
      if (startXRaw === undefined) return;
      const startX = Number(startXRaw);
      if (Number.isNaN(startX)) return;
      delete touchArea.dataset.touchStartX;

      const endX = event.changedTouches[0]?.clientX ?? startX;
      const deltaX = endX - startX;
      if (Math.abs(deltaX) < SWIPE_THRESHOLD_PX) return;
      if (deltaX > 0) {
        goPrev();
        return;
      }
      goNext();
    },
    [goNext, goPrev],
  );

  const item = (
    <li
      id={`event-${event.id}`}
      ref={ref}
      className={`timeline-item${event.significance === "high" ? " is-key" : ""}${open ? " is-open" : ""}`}
      style={{ "--i": index } as CSSProperties}
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
                    onClick={(event) => event.stopPropagation()}
                  >
                    {source.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {eventImages.map((image, imageIndex) => (
          <button
            key={image.key}
            type="button"
            className="pelican-svg-trigger"
            onClick={(event) => openViewerAt(image.globalIndex, event)}
            aria-label={`Open image ${imageIndex + 1} for ${event.title}`}
          >
            <div className="pelican-svg-frame">
              {image.kind === "svg" ? (
                <div dangerouslySetInnerHTML={{ __html: image.svg ?? "" }} />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image.src} alt={image.alt} />
              )}
            </div>
          </button>
        ))}
      </div>
    </li>
  );

  if (!viewerOpen || !currentImage || typeof document === "undefined") {
    return item;
  }

  return (
    <>
      {item}
      {createPortal(
        <div
          className="image-viewer-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={`${currentImage.eventTitle} image viewer`}
          onClick={handleViewerBackdropClick}
        >
          <button
            type="button"
            className="image-viewer-close"
            aria-label="Close image viewer"
            onClick={(event) => {
              event.stopPropagation();
              closeViewer();
            }}
          >
            <X size={18} strokeWidth={2.3} aria-hidden="true" />
          </button>

          {allViewerImages.length > 1 ? (
            <button
              type="button"
              className="image-viewer-nav image-viewer-nav-prev"
              aria-label="Previous image"
              onClick={(event) => {
                event.stopPropagation();
                goPrev();
              }}
            >
              <ChevronLeft size={21} strokeWidth={2.4} aria-hidden="true" />
            </button>
          ) : null}

          <div
            className="image-viewer-stage"
            onClick={(event) => event.stopPropagation()}
            onTouchStart={handleViewerTouchStart}
            onTouchEnd={handleViewerTouchEnd}
          >
            <div
              key={`${currentImage.key}:${normalizedViewerIndex ?? 0}`}
              className={`image-viewer-media image-viewer-media-${currentImage.kind}${viewerMotion ? ` is-moving-${viewerMotion}` : ""}`}
            >
              {currentImage.kind === "svg" ? (
                <div dangerouslySetInnerHTML={{ __html: currentImage.svg ?? "" }} />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={currentImage.src} alt={currentImage.alt} />
              )}
            </div>
          </div>

          {allViewerImages.length > 1 ? (
            <button
              type="button"
              className="image-viewer-nav image-viewer-nav-next"
              aria-label="Next image"
              onClick={(event) => {
                event.stopPropagation();
                goNext();
              }}
            >
              <ChevronRight size={21} strokeWidth={2.4} aria-hidden="true" />
            </button>
          ) : null}

          <div className="image-viewer-caption">
            <p className="image-viewer-meta">
              {currentImage.eventTitle} · {currentImage.eventOrganization}
            </p>
            <p className="image-viewer-date">{currentImage.eventDateLabel}</p>
            <p className="image-viewer-counter">
              {(normalizedViewerIndex ?? 0) + 1} / {allViewerImages.length}
            </p>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
