"use client";

import Link from "next/link";
import { useLayoutEffect, useRef } from "react";

import { ThemeToggle } from "@/components/theme/theme-toggle";

export function SiteHeader() {
  const ref = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const notify = () => {
      const height = Math.ceil(element.getBoundingClientRect().height);
      document.documentElement.style.setProperty("--header-h", `${height}px`);
      try {
        localStorage.setItem("rearview-header-h", String(height));
      } catch {}
    };

    notify();
    const rafId = requestAnimationFrame(notify);

    const observer = new ResizeObserver(() => notify());
    observer.observe(element);
    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, []);

  return (
    <header className="site-header" ref={ref}>
      <div className="site-header-inner">
        <Link className="brand" href="/">
          <span className="brand-title">Rearview Mirror</span>
        </Link>
        <ThemeToggle />
      </div>
    </header>
  );
}
