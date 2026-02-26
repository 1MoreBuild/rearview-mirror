"use client";

import { useEffect, useRef, useState } from "react";

type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "rearview-theme";

function getInitialTheme(): ResolvedTheme {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(theme: ResolvedTheme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<ResolvedTheme>("light");
  const mounted = useRef(false);

  useEffect(() => {
    setTheme(getInitialTheme());
    mounted.current = true;
  }, []);

  useEffect(() => {
    if (!mounted.current) return;
    applyTheme(theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  function toggle() {
    setTheme((t) => (t === "light" ? "dark" : "light"));
  }

  return (
    <button
      type="button"
      className="theme-cycle-button"
      onClick={toggle}
      aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
    >
      {theme === "light" ? "☀" : "☾"}
    </button>
  );
}
