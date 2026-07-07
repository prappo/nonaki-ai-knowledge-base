"use client";

import { useEffect, useState } from "react";
import { TopStrip } from "@/components/Shell";
import { WidgetChat } from "@/components/WidgetChat";
import { SourcePicker } from "@/components/SourcePicker";
import { SharePageSkeleton } from "@/components/Skeleton";

type WidgetConfig = {
  name: string;
  greeting: string;
  color: string;
  position: "right" | "left";
  sourceIds: string[];
  showCitations: boolean;
  suggestions: string[];
};

const COLOR_PRESETS = ["#0e7f93", "#2563eb", "#7c3aed", "#db2777", "#ea580c", "#16a34a", "#1c2429"];

export default function ShareWidgetPage() {
  const [config, setConfig] = useState<WidgetConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
    fetch("/api/share/widget")
      .then((r) => r.json())
      .then((d) => setConfig(d.config));
  }, []);

  const patch = (p: Partial<WidgetConfig>) =>
    setConfig((c) => (c ? { ...c, ...p } : c));

  async function save() {
    if (!config) return;
    setSaving(true);
    await fetch("/api/share/widget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const embedCode = `<script src="${origin}/widget.js" async></script>`;

  function copyEmbed() {
    navigator.clipboard.writeText(embedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (!config) {
    return (
      <>
        <TopStrip crumb="Nonaki / Share / Chat Widget" />
        <SharePageSkeleton />
      </>
    );
  }

  return (
    <>
      <TopStrip crumb="Nonaki / Share / Chat Widget" right={<span>{saved ? "SAVED ✓" : "EMBEDDABLE"}</span>} />
      <div className="flex min-h-0 flex-1 gap-7 overflow-y-auto scrollbar-thin p-7">
        {/* builder */}
        <div className="min-w-0 max-w-[560px] flex-1">
          <div className="flex items-baseline gap-2.5">
            <h1 className="text-[21px] font-semibold tracking-[-0.01em]">Chat widget</h1>
            <span className="text-xs text-muted">
              an AI chat bubble for your website, answering from your knowledge base
            </span>
          </div>

          {/* appearance */}
          <div className="mt-4 space-y-4 rounded-xl border border-line bg-card p-4">
            <div className="font-mono text-[10px] tracking-[0.08em] text-muted">APPEARANCE</div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-semibold">Bot name</span>
                <input
                  value={config.name}
                  onChange={(e) => patch({ name: e.target.value })}
                  className="mt-1 w-full rounded-[7px] border border-line bg-card px-3 py-2 text-xs outline-none focus:border-teal"
                />
              </label>
              <div>
                <span className="text-xs font-semibold">Position</span>
                <div className="mt-1 flex gap-1.5">
                  {(["right", "left"] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => patch({ position: p })}
                      className={`flex-1 rounded-[7px] border px-3 py-2 text-xs capitalize ${
                        config.position === p
                          ? "border-teal bg-teal-soft font-semibold text-teal-dark"
                          : "border-edge text-muted hover:border-teal"
                      }`}
                    >
                      Bottom {p}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <label className="block">
              <span className="text-xs font-semibold">Greeting message</span>
              <textarea
                value={config.greeting}
                onChange={(e) => patch({ greeting: e.target.value })}
                rows={2}
                className="mt-1 w-full resize-none rounded-[7px] border border-line bg-card px-3 py-2 text-xs outline-none focus:border-teal"
              />
            </label>
            <div>
              <span className="text-xs font-semibold">Accent color</span>
              <div className="mt-1.5 flex items-center gap-1.5">
                {COLOR_PRESETS.map((c) => (
                  <button
                    key={c}
                    onClick={() => patch({ color: c })}
                    className={`h-6 w-6 rounded-full border-2 transition-transform hover:scale-110 ${
                      config.color === c ? "border-ink" : "border-transparent"
                    }`}
                    style={{ background: c }}
                    title={c}
                  />
                ))}
                <input
                  type="color"
                  value={config.color}
                  onChange={(e) => patch({ color: e.target.value })}
                  className="h-6 w-8 cursor-pointer rounded border border-line bg-card"
                  title="Custom color"
                />
                <span className="font-mono text-[10px] text-muted">{config.color}</span>
              </div>
            </div>
            <div>
              <span className="text-xs font-semibold">Suggested questions</span>
              {config.suggestions.map((s, i) => (
                <div key={i} className="mt-1.5 flex gap-1.5">
                  <input
                    value={s}
                    onChange={(e) => {
                      const next = [...config.suggestions];
                      next[i] = e.target.value;
                      patch({ suggestions: next });
                    }}
                    className="min-w-0 flex-1 rounded-[7px] border border-line bg-card px-3 py-1.5 text-xs outline-none focus:border-teal"
                  />
                  <button
                    onClick={() =>
                      patch({ suggestions: config.suggestions.filter((_, j) => j !== i) })
                    }
                    className="px-1.5 text-muted hover:text-orange"
                  >
                    ✕
                  </button>
                </div>
              ))}
              {config.suggestions.length < 4 && (
                <button
                  onClick={() => patch({ suggestions: [...config.suggestions, ""] })}
                  className="mt-1.5 text-[11px] font-semibold text-teal hover:text-teal-dark"
                >
                  ＋ Add suggestion
                </button>
              )}
            </div>
          </div>

          {/* behaviour */}
          <div className="mt-4 space-y-4 rounded-xl border border-line bg-card p-4">
            <div className="font-mono text-[10px] tracking-[0.08em] text-muted">BEHAVIOUR</div>
            <SourcePicker
              value={config.sourceIds}
              onChange={(sourceIds) => patch({ sourceIds })}
              label="Answers from these sources"
            />
            <label className="flex cursor-pointer items-center gap-2.5">
              <button
                onClick={() => patch({ showCitations: !config.showCitations })}
                className={`relative h-[19px] w-[34px] rounded-[10px] transition-colors ${
                  config.showCitations ? "bg-teal" : "bg-edge"
                }`}
              >
                <span
                  className={`absolute top-[2.5px] h-3.5 w-3.5 rounded-full bg-white transition-all ${
                    config.showCitations ? "right-[2.5px]" : "left-[2.5px]"
                  }`}
                />
              </button>
              <span className="text-xs">
                <b>Show sources under answers</b>{" "}
                <span className="text-muted">— builds trust with visitors</span>
              </span>
            </label>
          </div>

          <div className="mt-4 flex items-center gap-2.5">
            <button
              onClick={save}
              disabled={saving}
              className="rounded-[7px] bg-teal px-5 py-2 text-xs font-semibold text-white hover:bg-teal-dark disabled:opacity-60"
            >
              {saving ? "Saving…" : saved ? "Saved ✓" : "Save widget"}
            </button>
            <span className="text-[11px] text-faint">
              Changes go live on your website immediately after saving.
            </span>
          </div>

          {/* embed code */}
          <div className="mt-4 rounded-xl border border-teal-line bg-teal-mist p-4">
            <div className="flex items-center">
              <div className="font-mono text-[10px] tracking-[0.08em] text-teal">
                ADD TO YOUR WEBSITE
              </div>
              <button
                onClick={copyEmbed}
                className="ml-auto rounded-md bg-teal px-3 py-1 text-[11px] font-semibold text-white hover:bg-teal-dark"
              >
                {copied ? "Copied ✓" : "Copy code"}
              </button>
            </div>
            <pre className="scrollbar-thin mt-2 overflow-x-auto rounded-lg bg-ink p-3 font-mono text-[11px] leading-relaxed text-[#7fd1de]">
              {embedCode}
            </pre>
            <div className="mt-2 text-[11px] leading-relaxed text-teal-ink">
              Paste this once before the closing <span className="font-mono">&lt;/body&gt;</span>{" "}
              tag. A floating chat button appears on every page — visitors&apos; questions
              are answered live from the sources selected above.
            </div>
          </div>
        </div>

        {/* live preview */}
        <div className="w-[390px] flex-none">
          <div className="sticky top-0">
            <div className="mb-2 flex items-center font-mono text-[10px] tracking-[0.08em] text-muted">
              LIVE PREVIEW
              <span className="ml-auto flex items-center gap-1.5 text-green">
                <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-green" /> REAL ANSWERS
              </span>
            </div>
            <div className="h-[560px] overflow-hidden rounded-2xl border border-line shadow-[0_12px_48px_rgba(10,20,25,0.18)]">
              <WidgetChat config={config} surface="widget" />
            </div>
            <div className="mt-2 text-center text-[10.5px] text-faint">
              This is exactly what visitors see. Try asking it something!
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
