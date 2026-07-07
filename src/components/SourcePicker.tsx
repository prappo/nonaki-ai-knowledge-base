"use client";

import { useEffect, useState } from "react";
import { SourceIcon } from "./SourceIcon";

type SourceInfo = {
  id: string;
  name: string;
  type: string;
  siteUrl?: string;
  docs: number;
};

/**
 * Source scope control for share configs (widget / chatbot / KB site).
 * Two explicit modes — "All sources" (stored as sourceIds: []) keeps following
 * newly connected sources; "Pick sources" stores an explicit id list.
 */
export function SourcePicker({
  value,
  onChange,
  label = "Answers from",
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  label?: string;
}) {
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [pickMode, setPickMode] = useState(false);

  useEffect(() => {
    fetch("/api/sources")
      .then((r) => r.json())
      .then((d) =>
        setSources(
          (d.sources ?? []).map(
            (s: { id: string; name: string; type: string; config: string | null; _count?: { documents: number } }) => {
              let siteUrl: string | undefined;
              try {
                siteUrl = (JSON.parse(s.config ?? "{}") as { url?: string }).url;
              } catch {
                siteUrl = undefined;
              }
              return {
                id: s.id,
                name: s.name,
                type: s.type,
                siteUrl,
                docs: s._count?.documents ?? 0,
              };
            }
          )
        )
      )
      .catch(() => {});
  }, []);

  // A saved explicit selection means pick mode; [] means "all".
  const picking = pickMode || value.length > 0;

  function switchToAll() {
    setPickMode(false);
    onChange([]);
  }

  function switchToPick() {
    setPickMode(true);
    // seed with everything checked so unchecking is the only action needed
    if (value.length === 0) onChange(sources.map((s) => s.id));
  }

  function toggle(id: string) {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  }

  return (
    <div>
      <div className="text-xs font-semibold">{label}</div>

      {/* mode toggle */}
      <div className="mt-1.5 flex gap-1.5">
        <button
          onClick={switchToAll}
          className={`flex-1 rounded-[7px] border px-3 py-2 text-xs ${
            !picking
              ? "border-teal bg-teal-soft font-semibold text-teal-dark"
              : "border-edge text-muted hover:border-teal"
          }`}
        >
          All sources ({sources.length})
        </button>
        <button
          onClick={switchToPick}
          className={`flex-1 rounded-[7px] border px-3 py-2 text-xs ${
            picking
              ? "border-teal bg-teal-soft font-semibold text-teal-dark"
              : "border-edge text-muted hover:border-teal"
          }`}
        >
          Pick sources
        </button>
      </div>

      {/* checkbox list */}
      {picking && (
        <div className="mt-2 overflow-hidden rounded-lg border border-line">
          {sources.map((s, i) => (
            <label
              key={s.id}
              className={`flex cursor-pointer items-center gap-2.5 px-3 py-2 hover:bg-hover ${
                i < sources.length - 1 ? "border-b border-row-line" : ""
              } ${value.includes(s.id) ? "" : "opacity-60"}`}
            >
              <input
                type="checkbox"
                checked={value.includes(s.id)}
                onChange={() => toggle(s.id)}
                className="h-3.5 w-3.5 flex-none accent-[#0e7f93]"
              />
              <SourceIcon type={s.type} siteUrl={s.siteUrl} size={22} />
              <span className="min-w-0 flex-1 truncate text-xs font-semibold">{s.name}</span>
              <span className="flex-none font-mono text-[9px] uppercase text-faint">
                {s.type} · {s.docs} docs
              </span>
            </label>
          ))}
          {sources.length === 0 && (
            <div className="px-3 py-3 text-[11px] text-muted">No sources connected yet.</div>
          )}
        </div>
      )}

      <div className="mt-1 text-[10.5px] text-faint">
        {!picking
          ? "Answers from every source, including ones you connect later."
          : value.length === 0
            ? ""
            : `Answers only from the ${value.length} checked source${value.length === 1 ? "" : "s"}.`}
      </div>
      {picking && value.length === 0 && (
        <div className="mt-1 rounded-lg border border-warn-line bg-warn-bg px-3 py-1.5 text-[10.5px] text-warn-text">
          Nothing checked — this behaves like “All sources” until you check at least one.
        </div>
      )}
    </div>
  );
}
