"use client";

import { useRef, useState } from "react";

const QUICK_ACTIONS: { label: string; instruction: string }[] = [
  { label: "✦ Improve", instruction: "Improve the writing — clearer, tighter, better flow" },
  { label: "Rewrite", instruction: "Rewrite this differently while keeping the same meaning" },
  { label: "Shorten", instruction: "Make this significantly shorter without losing meaning" },
  { label: "Expand", instruction: "Expand this with a bit more helpful detail" },
  { label: "Fix grammar", instruction: "Fix spelling, grammar and punctuation only — change nothing else" },
];

type PendingRewrite = {
  start: number;
  end: number;
  original: string;
  replacement: string;
  instruction: string;
};

/**
 * Textarea with inline AI editing: select any words/sentences, hit a quick
 * action (or type your own instruction) and review the AI's replacement
 * before it's spliced into the selection.
 */
export function AiTextarea({
  value,
  onChange,
  title,
  placeholder,
  rows,
  wrapperClassName = "",
  textareaClassName = "",
}: {
  value: string;
  onChange: (value: string) => void;
  /** Document title, given to the AI as context. */
  title?: string;
  placeholder?: string;
  rows?: number;
  wrapperClassName?: string;
  textareaClassName?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [sel, setSel] = useState({ start: 0, end: 0 });
  const [busy, setBusy] = useState<string | null>(null); // action label while running
  const [custom, setCustom] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingRewrite | null>(null);

  const hasSelection = sel.end > sel.start;
  const locked = busy !== null || pending !== null;

  const updateSel = () => {
    const el = ref.current;
    if (el) setSel({ start: el.selectionStart, end: el.selectionEnd });
  };

  async function runAi(instruction: string, label: string) {
    const { start, end } = sel;
    if (end <= start || locked) return;
    setBusy(label);
    setError(null);
    try {
      const res = await fetch("/api/assistant/inline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: value.slice(start, end),
          instruction,
          title,
          before: value.slice(Math.max(0, start - 500), start),
          after: value.slice(end, end + 500),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Rewrite failed");
      setPending({
        start,
        end,
        original: value.slice(start, end),
        replacement: data.text as string,
        instruction: label,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rewrite failed");
    } finally {
      setBusy(null);
    }
  }

  function runCustom() {
    const instruction = custom.trim();
    if (!instruction) return;
    setCustom("");
    runAi(instruction, instruction.length > 32 ? `${instruction.slice(0, 32)}…` : instruction);
  }

  function accept() {
    if (!pending) return;
    const p = pending;
    onChange(value.slice(0, p.start) + p.replacement + value.slice(p.end));
    setPending(null);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (el) {
        el.focus();
        el.setSelectionRange(p.start, p.start + p.replacement.length);
        setSel({ start: p.start, end: p.start + p.replacement.length });
      }
    });
  }

  return (
    <div className={`flex flex-col overflow-hidden rounded-lg border border-line bg-card focus-within:border-teal ${wrapperClassName}`}>
      {/* AI toolbar */}
      <div className="flex flex-none flex-wrap items-center gap-1.5 border-b border-hairline bg-panel px-2.5 py-1.5">
        <span className={`text-xs ${hasSelection ? "text-teal" : "text-faint"}`}>✦</span>
        {busy ? (
          <span className="pulse-dot text-[11px] font-semibold text-teal">{busy}…</span>
        ) : (
          <>
            {QUICK_ACTIONS.map((a) => (
              <button
                key={a.label}
                type="button"
                // mousedown would steal the textarea selection before click fires
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => runAi(a.instruction, a.label)}
                disabled={!hasSelection || locked}
                className="rounded-md border border-edge bg-card px-2 py-[3px] text-[10.5px] font-semibold text-slate transition-colors hover:border-teal hover:text-teal disabled:cursor-not-allowed disabled:opacity-40"
              >
                {a.label}
              </button>
            ))}
            <span className="relative ml-1 min-w-[150px] flex-1">
              <input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    runCustom();
                  }
                }}
                disabled={!hasSelection || locked}
                placeholder={
                  hasSelection
                    ? "Or tell the AI what to do with the selection… ↵"
                    : "Select text below to edit it with AI"
                }
                className="w-full rounded-md border border-transparent bg-transparent px-2 py-[3px] text-[11px] outline-none placeholder:text-faint focus:border-teal focus:bg-card disabled:cursor-not-allowed"
              />
            </span>
          </>
        )}
      </div>

      {error && (
        <div className="flex-none border-b border-warn-line bg-warn-bg px-3 py-1.5 text-[11px] text-warn-text">
          {error}
          <button onClick={() => setError(null)} className="ml-2 font-semibold underline">
            dismiss
          </button>
        </div>
      )}

      {/* AI suggestion review */}
      {pending && (
        <div className="flex-none border-b border-teal-hairline bg-teal-mist px-3 py-2.5">
          <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.06em] text-teal">
            ✦ {pending.instruction}
            <span className="ml-auto flex gap-1.5">
              <button
                onClick={accept}
                className="rounded-md bg-teal px-2.5 py-1 font-sans text-[10.5px] font-semibold normal-case tracking-normal text-white hover:bg-teal-dark"
              >
                Replace selection
              </button>
              <button
                onClick={() => setPending(null)}
                className="rounded-md border border-teal-line bg-card px-2.5 py-1 font-sans text-[10.5px] font-semibold normal-case tracking-normal text-slate hover:text-ink"
              >
                Discard
              </button>
            </span>
          </div>
          <div className="mt-2 max-h-40 overflow-y-auto scrollbar-thin rounded-lg border border-line bg-card px-3 py-2 text-[11.5px] leading-[1.6]">
            <div className="whitespace-pre-wrap bg-diff-del text-slate line-through decoration-diff-del-line">
              {pending.original}
            </div>
            <div className="mt-1.5 whitespace-pre-wrap bg-diff-add text-body">
              {pending.replacement}
            </div>
          </div>
        </div>
      )}

      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onSelect={updateSel}
        onKeyUp={updateSel}
        onMouseUp={updateSel}
        readOnly={locked}
        placeholder={placeholder}
        rows={rows}
        className={`w-full resize-none bg-transparent outline-none ${
          locked ? "opacity-70" : ""
        } ${textareaClassName}`}
      />
    </div>
  );
}
