import { Moon, Sun } from "@phosphor-icons/react";
import { toggleTheme, useTheme } from "../lib/theme";

/** Sun/moon toggle. The theme change is revealed from the button itself. */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const theme = useTheme();
  const dark = theme === "dark";
  const label = dark ? "Switch to light theme" : "Switch to dark theme";

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const keyboard = e.detail === 0;
        toggleTheme({
          x: keyboard ? rect.left + rect.width / 2 : e.clientX,
          y: keyboard ? rect.top + rect.height / 2 : e.clientY,
        });
      }}
      className={`press relative grid size-9 shrink-0 place-items-center rounded-md border border-line bg-surface text-muted hover:bg-surface-2 hover:text-fg ${className}`}
    >
      <Sun
        size={17}
        weight="bold"
        aria-hidden
        className={`theme-icon absolute ${dark ? "-rotate-90 scale-50 opacity-0" : "rotate-0 scale-100 opacity-100"}`}
      />
      <Moon
        size={17}
        weight="bold"
        aria-hidden
        className={`theme-icon absolute ${dark ? "rotate-0 scale-100 opacity-100" : "rotate-90 scale-50 opacity-0"}`}
      />
    </button>
  );
}
