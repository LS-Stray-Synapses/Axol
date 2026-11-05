// A small dropdown: a button that toggles a panel. Closes on outside click,
// Esc, or when the content calls close(). Used for the tab list and for slot
// entries that don't fit (the "⋯" menus).

import { useEffect, useRef, useState, type ReactNode } from "react";

interface Props {
  label: ReactNode;
  title: string;
  /** "down" for the header/sidebar, "up" for the composer at the bottom of the screen */
  placement?: "down" | "up";
  align?: "left" | "right";
  children: ReactNode | ((close: () => void) => ReactNode);
  "data-testid"?: string;
}

export function Popover({ label, title, placement = "down", align = "right", children, ...rest }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = () => setOpen(false);
  return (
    <div ref={root} className="relative shrink-0" data-testid={rest["data-testid"]}>
      <button
        type="button"
        title={title}
        aria-label={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`rounded px-1.5 py-0.5 text-muted hover:bg-raised hover:text-fg ${open ? "bg-raised text-fg" : ""}`}
      >
        {label}
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute z-20 flex min-w-44 flex-col items-start gap-1 rounded-md border border-border bg-panel p-1.5 shadow-xl
            ${placement === "down" ? "top-full mt-1" : "bottom-full mb-1"} ${align === "right" ? "right-0" : "left-0"}`}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </div>
  );
}
