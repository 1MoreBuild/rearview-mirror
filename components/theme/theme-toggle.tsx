"use client";

import { useEffect, useRef, useState } from "react";

type ThemeChoice = "system" | "light" | "dark";

const STORAGE_KEY = "rearview-theme";
const THEME_CHOICES: ThemeChoice[] = ["system", "light", "dark"];

function readStoredChoice(): ThemeChoice {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "system" || stored === "light" || stored === "dark") {
    return stored;
  }
  return "system";
}

function resolveTheme(choice: ThemeChoice): "light" | "dark" {
  if (choice === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return choice;
}

function applyTheme(choice: ThemeChoice): void {
  const resolved = resolveTheme(choice);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}

export function ThemeToggle() {
  // Always start with "system" to match SSR output
  const [choice, setChoice] = useState<ThemeChoice>("system");
  const mounted = useRef(false);

  // After hydration, read the real stored choice
  useEffect(() => {
    setChoice(readStoredChoice());
    mounted.current = true;
  }, []);

  // Apply theme & persist — but only after mount to avoid overwriting localStorage
  useEffect(() => {
    if (!mounted.current) return;

    applyTheme(choice);
    localStorage.setItem(STORAGE_KEY, choice);

    if (choice !== "system") return;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onMediaChange = () => applyTheme("system");
    media.addEventListener("change", onMediaChange);
    return () => media.removeEventListener("change", onMediaChange);
  }, [choice]);

  return (
    <div className="theme-toggle" role="group" aria-label="Theme toggle">
      {THEME_CHOICES.map((themeChoice) => {
        const isActive = choice === themeChoice;

        return (
          <button
            key={themeChoice}
            type="button"
            className={`theme-toggle-button${isActive ? " is-active" : ""}`}
            onClick={() => setChoice(themeChoice)}
            aria-pressed={isActive}
          >
            {themeChoice}
          </button>
        );
      })}
    </div>
  );
}
