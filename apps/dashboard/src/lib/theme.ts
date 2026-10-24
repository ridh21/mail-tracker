import { useEffect, useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "mt-theme";
const listeners = new Set<() => void>();

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Explicit choice from <html data-theme>, otherwise the OS preference. */
export function currentTheme(): Theme {
  const attr = document.documentElement.dataset.theme;
  return attr === "light" || attr === "dark" ? attr : systemTheme();
}

function notify() {
  listeners.forEach((listener) => listener());
}

export function useTheme(): Theme {
  const theme = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    currentTheme,
    () => "light" as const,
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (!document.documentElement.dataset.theme) notify();
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return theme;
}

/**
 * Flip the theme, persisting the choice. When the browser supports view
 * transitions we reveal the new theme as a circle from the toggle itself.
 */
export function toggleTheme(origin?: { x: number; y: number }) {
  const next: Theme = currentTheme() === "dark" ? "light" : "dark";
  const commit = () => {
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private mode / storage disabled: the choice just won't persist.
    }
    notify();
  };

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!origin || reduceMotion || !document.startViewTransition) {
    commit();
    return;
  }

  const radius = Math.hypot(
    Math.max(origin.x, window.innerWidth - origin.x),
    Math.max(origin.y, window.innerHeight - origin.y),
  );

  const transition = document.startViewTransition(commit);
  transition.ready
    .then(() => {
      document.documentElement
        .animate(
          {
            clipPath: [
              `circle(0px at ${origin.x}px ${origin.y}px)`,
              `circle(${radius}px at ${origin.x}px ${origin.y}px)`,
            ],
          },
          {
            duration: 480,
            easing: "cubic-bezier(0.23, 1, 0.32, 1)",
            pseudoElement: "::view-transition-new(root)",
          },
        )
        .finished.catch(() => {});
    })
    .catch(() => {});
}
