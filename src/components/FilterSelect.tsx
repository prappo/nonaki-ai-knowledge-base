"use client";

import { useEffect, useRef, useState } from "react";

export type FilterOption = { value: string; label: string; count?: number };

/**
 * Compact single-select filter dropdown — pill trigger + popover list, same
 * visual language as SourceSelect. The first option is expected to be the
 * "all" entry with value "". Selecting the active option clears it.
 */
export function FilterSelect({
  options,
  value,
  onChange,
  width = "w-48",
}: {
  options: FilterOption[];
  value: string;
  onChange: (value: string) => void;
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const selected = options.find((o) => o.value === value && o.value !== "") ?? null;
  const display = selected ?? options[0];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
          selected
            ? "border-teal bg-teal-soft font-semibold text-teal-dark"
            : "border-edge bg-card text-muted hover:border-teal hover:text-teal"
        }`}
      >
        {display?.label}
        <span className="text-[8px]">▾</span>
      </button>

      {open && (
        <div
          className={`absolute left-0 top-[calc(100%+6px)] z-30 ${width} overflow-hidden rounded-lg border border-line bg-card shadow-[0_8px_28px_rgba(10,20,25,0.14)]`}
        >
          <div className="max-h-64 overflow-y-auto scrollbar-thin">
            {options.map((o, i) => (
              <button
                key={o.value}
                onClick={() => {
                  onChange(o.value === value ? "" : o.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-hover ${
                  i === 0 ? "border-b border-hairline bg-panel" : "border-b border-row-line last:border-0"
                } ${o.value === value || (!selected && i === 0) ? "font-semibold text-teal-dark" : ""}`}
              >
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.count !== undefined && (
                  <span className="flex-none font-mono text-[9.5px] text-faint">{o.count}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
