"use client";

import { useEffect, useRef, useState } from "react";
import { TopStrip } from "@/components/Shell";
import { SourcePicker } from "@/components/SourcePicker";
import { SharePageSkeleton } from "@/components/Skeleton";

type KbConfig = {
  title: string;
  description: string;
  accent: string;
  theme: "light" | "dark";
  layout: "cards" | "list";
  sourceIds: string[];
  showAsk: boolean;
};

const COLOR_PRESETS = ["#0e7f93", "#2563eb", "#7c3aed", "#db2777", "#ea580c", "#16a34a", "#1c2429"];

export default function ShareKbPage() {
  const [config, setConfig] = useState<KbConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
    fetch("/api/share/kb")
      .then((r) => r.json())
      .then((d) => setConfig(d.config));
  }, []);

  const patch = (p: Partial<KbConfig>) => setConfig((c) => (c ? { ...c, ...p } : c));

  async function save() {
    if (!config) return;
    setSaving(true);
    await fetch("/api/share/kb", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    frameRef.current?.contentWindow?.location.reload(); // refresh the preview
  }

  function copy(text: string, which: string) {
    navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 1500);
  }

  if (!config) {
    return (
      <>
        <TopStrip crumb="Nonaki / Share / Knowledge Base" />
        <SharePageSkeleton />
      </>
    );
  }

  const publicUrl = `${origin}/embed/kb`;
  const iframeCode = `<iframe src="${publicUrl}" style="width:100%;height:100vh;border:0" title="${config.title}"></iframe>`;

  return (
    <>
      <TopStrip
        crumb="Nonaki / Share / Knowledge Base"
        right={<span>{saved ? "SAVED ✓" : "PUBLIC SITE"}</span>}
      />
      <div className="flex min-h-0 flex-1 gap-7 overflow-y-auto scrollbar-thin p-7">
        {/* builder */}
        <div className="min-w-0 max-w-[480px] flex-1">
          <div className="flex items-baseline gap-2.5">
            <h1 className="text-[21px] font-semibold tracking-[-0.01em]">Knowledge base site</h1>
          </div>
          <p className="mt-0.5 text-xs text-muted">
            A public, themeable help-center built from your indexed docs — searchable,
            browsable, with optional AI answers.
          </p>

          <div className="mt-4 space-y-4 rounded-xl border border-line bg-card p-4">
            <div className="font-mono text-[10px] tracking-[0.08em] text-muted">CONTENT</div>
            <label className="block">
              <span className="text-xs font-semibold">Site title</span>
              <input
                value={config.title}
                onChange={(e) => patch({ title: e.target.value })}
                className="mt-1 w-full rounded-[7px] border border-line bg-card px-3 py-2 text-xs outline-none focus:border-teal"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold">Description</span>
              <textarea
                value={config.description}
                onChange={(e) => patch({ description: e.target.value })}
                rows={2}
                className="mt-1 w-full resize-none rounded-[7px] border border-line bg-card px-3 py-2 text-xs outline-none focus:border-teal"
              />
            </label>
            <SourcePicker
              value={config.sourceIds}
              onChange={(sourceIds) => patch({ sourceIds })}
              label="Published sources"
            />
          </div>

          <div className="mt-4 space-y-4 rounded-xl border border-line bg-card p-4">
            <div className="font-mono text-[10px] tracking-[0.08em] text-muted">THEME</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="text-xs font-semibold">Mode</span>
                <div className="mt-1 flex gap-1.5">
                  {(["light", "dark"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => patch({ theme: m })}
                      className={`flex-1 rounded-[7px] border px-3 py-2 text-xs capitalize ${
                        config.theme === m
                          ? "border-teal bg-teal-soft font-semibold text-teal-dark"
                          : "border-edge text-muted hover:border-teal"
                      }`}
                    >
                      {m === "light" ? "☀ Light" : "☾ Dark"}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <span className="text-xs font-semibold">Layout</span>
                <div className="mt-1 flex gap-1.5">
                  {(["cards", "list"] as const).map((l) => (
                    <button
                      key={l}
                      onClick={() => patch({ layout: l })}
                      className={`flex-1 rounded-[7px] border px-3 py-2 text-xs capitalize ${
                        config.layout === l
                          ? "border-teal bg-teal-soft font-semibold text-teal-dark"
                          : "border-edge text-muted hover:border-teal"
                      }`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div>
              <span className="text-xs font-semibold">Accent color</span>
              <div className="mt-1.5 flex items-center gap-1.5">
                {COLOR_PRESETS.map((c) => (
                  <button
                    key={c}
                    onClick={() => patch({ accent: c })}
                    className={`h-6 w-6 rounded-full border-2 transition-transform hover:scale-110 ${
                      config.accent === c ? "border-ink" : "border-transparent"
                    }`}
                    style={{ background: c }}
                  />
                ))}
                <input
                  type="color"
                  value={config.accent}
                  onChange={(e) => patch({ accent: e.target.value })}
                  className="h-6 w-8 cursor-pointer rounded border border-line bg-card"
                />
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-2.5">
              <button
                onClick={() => patch({ showAsk: !config.showAsk })}
                className={`relative h-[19px] w-[34px] rounded-[10px] transition-colors ${
                  config.showAsk ? "bg-teal" : "bg-edge"
                }`}
              >
                <span
                  className={`absolute top-[2.5px] h-3.5 w-3.5 rounded-full bg-white transition-all ${
                    config.showAsk ? "right-[2.5px]" : "left-[2.5px]"
                  }`}
                />
              </button>
              <span className="text-xs">
                <b>“Ask AI” button</b>{" "}
                <span className="text-muted">— floating AI chat on the public site</span>
              </span>
            </label>
          </div>

          <div className="mt-4">
            <button
              onClick={save}
              disabled={saving}
              className="rounded-[7px] bg-teal px-5 py-2 text-xs font-semibold text-white hover:bg-teal-dark disabled:opacity-60"
            >
              {saving ? "Saving…" : saved ? "Saved ✓" : "Save & publish"}
            </button>
          </div>

          {/* share */}
          <div className="mt-4 space-y-3 rounded-xl border border-teal-line bg-teal-mist p-4">
            <div className="font-mono text-[10px] tracking-[0.08em] text-teal">SHARE IT</div>
            <div>
              <div className="flex items-center">
                <span className="text-xs font-semibold">Public link</span>
                <button
                  onClick={() => copy(publicUrl, "link")}
                  className="ml-auto rounded-md bg-teal px-3 py-1 text-[11px] font-semibold text-white hover:bg-teal-dark"
                >
                  {copied === "link" ? "Copied ✓" : "Copy link"}
                </button>
              </div>
              <a
                href={publicUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1 block truncate font-mono text-[11px] text-teal underline-offset-2 hover:underline"
              >
                {publicUrl} ↗
              </a>
            </div>
            <div>
              <div className="flex items-center">
                <span className="text-xs font-semibold">Embed on your site</span>
                <button
                  onClick={() => copy(iframeCode, "iframe")}
                  className="ml-auto rounded-md border border-teal-line bg-card px-3 py-1 text-[11px] font-semibold text-teal hover:bg-teal-soft"
                >
                  {copied === "iframe" ? "Copied ✓" : "Copy code"}
                </button>
              </div>
              <pre className="scrollbar-thin mt-1 overflow-x-auto rounded-lg bg-ink p-3 font-mono text-[10.5px] leading-relaxed text-[#7fd1de]">
                {iframeCode}
              </pre>
            </div>
          </div>
        </div>

        {/* preview */}
        <div className="min-w-0 flex-1">
          <div className="sticky top-0">
            <div className="mb-2 flex items-center font-mono text-[10px] tracking-[0.08em] text-muted">
              LIVE PREVIEW — SAVED VERSION
              <button
                onClick={() => frameRef.current?.contentWindow?.location.reload()}
                className="ml-auto rounded-md border border-edge px-2 py-0.5 text-[10px] font-semibold text-muted hover:border-teal hover:text-teal"
              >
                ↻ Refresh
              </button>
            </div>
            <iframe
              ref={frameRef}
              src="/embed/kb"
              title="Knowledge base preview"
              className="h-[calc(100vh-140px)] min-h-[480px] w-full rounded-2xl border border-line bg-card shadow-[0_12px_48px_rgba(10,20,25,0.14)]"
            />
          </div>
        </div>
      </div>
    </>
  );
}
