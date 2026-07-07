"use client";

import { useEffect, useRef, useState } from "react";
import { SourceIcon } from "./SourceIcon";

export type SourceOption = {
  id: string;
  name: string;
  type: string;
  siteUrl?: string;
};

/**
 * Single-select source filter with brand icons / site favicons — used in the
 * Documents and Imports filter bars. "" = all sources.
 */
export function SourceSelect({
  sources,
  value,
  onChange,
  allLabel = "All sources",
}: {
  sources: SourceOption[];
  value: string;
  onChange: (id: string) => void;
  allLabel?: string;
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

  const selected = sources.find((s) => s.id === value) ?? null;

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
        {selected && <SourceIcon type={selected.type} siteUrl={selected.siteUrl} size={16} />}
        {selected ? selected.name : allLabel}
        <span className="text-[8px]">▾</span>
      </button>

      {open && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-30 w-64 overflow-hidden rounded-lg border border-line bg-card shadow-[0_8px_28px_rgba(10,20,25,0.14)]">
          <button
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
            className={`flex w-full items-center gap-2 border-b border-hairline bg-panel px-3 py-2 text-left text-xs hover:bg-hover ${
              !selected ? "font-semibold text-teal-dark" : ""
            }`}
          >
            {allLabel}
          </button>
          <div className="max-h-56 overflow-y-auto scrollbar-thin">
            {sources.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  onChange(s.id === value ? "" : s.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 border-b border-row-line px-3 py-2 text-left text-xs last:border-0 hover:bg-hover ${
                  s.id === value ? "bg-teal-wash font-semibold text-teal-dark" : ""
                }`}
              >
                <SourceIcon type={s.type} siteUrl={s.siteUrl} size={20} />
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                <span className="flex-none rounded bg-chip px-1.5 py-px font-mono text-[8.5px] uppercase text-muted">
                  {s.type}
                </span>
              </button>
            ))}
            {sources.length === 0 && (
              <div className="px-3 py-3 text-[11px] text-muted">No sources connected yet.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
