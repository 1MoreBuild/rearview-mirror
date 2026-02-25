"use client";

import { useEffect, useState } from "react";

type ThemeChoice = "system" | "light" | "dark";

const STORAGE_KEY = "rearview-theme";
const THEME_CHOICES: ThemeChoice[] = ["system", "light", "dark"];

function getStoredChoice(): ThemeChoice {
  if (typeof window === "undefined") {
    return "system";
  }

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
  const root = document.documentElement;

  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
}

export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>(getStoredChoice);

  useEffect(() => {
    applyTheme(choice);
    localStorage.setItem(STORAGE_KEY, choice);

    if (choice !== "system") {
      return;
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onMediaChange = () => applyTheme("system");

    media.addEventListener("change", onMediaChange);
    return () => {
      media.removeEventListener("change", onMediaChange);
    };
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
