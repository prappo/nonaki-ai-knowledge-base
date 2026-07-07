"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { WidgetChat } from "@/components/WidgetChat";

type KbConfig = {
  title: string;
  description: string;
  accent: string;
  theme: "light" | "dark";
  layout: "cards" | "list";
  showAsk: boolean;
};

type KbDoc = {
  id: string;
  title: string;
  excerpt: string | null;
  kind: string;
  updatedAt: string;
  source: { name: string };
};

type SearchHit = { documentId: string; title: string; snippet: string };

const THEMES = {
  light: {
    bg: "#f6f8f9",
    card: "#ffffff",
    text: "#1c2429",
    muted: "#6b7a80",
    faint: "#9aa6ab",
    border: "#e3e9ea",
    chip: "#eef2f3",
  },
  dark: {
    bg: "#0f1518",
    card: "#161f25",
    text: "#e7edf0",
    muted: "#8b9aa0",
    faint: "#5f6f75",
    border: "#243239",
    chip: "#1e282d",
  },
};

export default function EmbedKbPage() {
  const [config, setConfig] = useState<KbConfig | null>(null);
  const [docs, setDocs] = useState<KbDoc[]>([]);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [reader, setReader] = useState<{ title: string; content: string; source: string } | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch("/api/embed/kb-data")
      .then((r) => r.json())
      .then((d) => {
        setConfig(d.config);
        setDocs(d.docs ?? []);
        if (d.config?.title) document.title = d.config.title;
      });
  }, []);

  // debounced search
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (!query.trim()) {
      setHits(null);
      return;
    }
    debounce.current = setTimeout(async () => {
      setSearching(true);
      try {
        const d = await fetch("/api/embed/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query }),
        }).then((r) => r.json());
        // dedupe hits by document
        const seen = new Set<string>();
        setHits(
          (d.results ?? []).filter((h: SearchHit) => {
            if (seen.has(h.documentId)) return false;
            seen.add(h.documentId);
            return true;
          })
        );
      } finally {
        setSearching(false);
      }
    }, 350);
  }, [query]);

  async function openDoc(id: string) {
    const d = await fetch(`/api/embed/doc/${id}`).then((r) => r.json());
    if (d.doc) {
      setReader({ title: d.doc.title, content: d.doc.content, source: d.doc.source.name });
    }
  }

  const groups = useMemo(() => {
    const map = new Map<string, KbDoc[]>();
    for (const doc of docs) {
      const list = map.get(doc.source.name) ?? [];
      list.push(doc);
      map.set(doc.source.name, list);
    }
    return [...map.entries()];
  }, [docs]);

  if (!config) return null;
  const t = THEMES[config.theme] ?? THEMES.light;
  const accent = config.accent || "#0e7f93";

  return (
    <div
      className="h-screen overflow-y-auto"
      style={{ background: t.bg, color: t.text, colorScheme: config.theme }}
    >
      {/* hero */}
      <div style={{ background: accent }} className="px-6 pb-14 pt-12 text-white">
        <div className="mx-auto max-w-[860px]">
          <h1 className="text-[26px] font-bold tracking-[-0.01em]">{config.title}</h1>
          <p className="mt-1 max-w-[560px] text-[13px] leading-relaxed opacity-85">
            {config.description}
          </p>
        </div>
      </div>

      {/* search */}
      <div className="mx-auto -mt-6 max-w-[860px] px-6">
        <div
          className="flex items-center gap-2.5 rounded-xl px-4 py-3 shadow-[0_8px_28px_rgba(0,0,0,0.12)]"
          style={{ background: t.card, border: `1px solid ${t.border}` }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={t.faint} strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the knowledge base…"
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
            style={{ color: t.text }}
          />
          {searching && (
            <span className="text-[10px]" style={{ color: t.faint }}>
              searching…
            </span>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-[860px] px-6 pb-24 pt-6">
        {/* search results */}
        {hits && (
          <div className="mb-8">
            <div className="mb-2 font-mono text-[10px] tracking-[0.1em]" style={{ color: t.muted }}>
              {hits.length} RESULT{hits.length === 1 ? "" : "S"}
            </div>
            <div className="space-y-2">
              {hits.map((h) => (
                <button
                  key={h.documentId}
                  onClick={() => openDoc(h.documentId)}
                  className="block w-full rounded-xl px-4 py-3 text-left transition-transform hover:-translate-y-px"
                  style={{ background: t.card, border: `1px solid ${t.border}` }}
                >
                  <div className="text-[13px] font-semibold" style={{ color: accent }}>
                    {h.title}
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-xs leading-relaxed" style={{ color: t.muted }}>
                    {h.snippet}
                  </div>
                </button>
              ))}
              {hits.length === 0 && (
                <div className="rounded-xl px-4 py-6 text-center text-xs" style={{ background: t.card, border: `1px solid ${t.border}`, color: t.muted }}>
                  Nothing matched{config.showAsk ? " — try asking the AI instead ↘" : "."}
                </div>
              )}
            </div>
          </div>
        )}

        {/* browse */}
        {!hits &&
          groups.map(([sourceName, groupDocs]) => (
            <div key={sourceName} className="mb-8">
              <div className="mb-2.5 flex items-baseline gap-2">
                <h2 className="text-[15px] font-bold">{sourceName}</h2>
                <span className="text-[11px]" style={{ color: t.faint }}>
                  {groupDocs.length} articles
                </span>
              </div>
              <div className={config.layout === "cards" ? "grid grid-cols-1 gap-2.5 sm:grid-cols-2" : "space-y-2"}>
                {groupDocs.slice(0, 30).map((doc) => (
                  <button
                    key={doc.id}
                    onClick={() => openDoc(doc.id)}
                    className="block w-full rounded-xl px-4 py-3 text-left transition-transform hover:-translate-y-px"
                    style={{ background: t.card, border: `1px solid ${t.border}` }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-semibold">{doc.title}</span>
                      <span
                        className="ml-auto flex-none rounded px-1.5 py-px font-mono text-[8px] uppercase"
                        style={{ background: t.chip, color: t.muted }}
                      >
                        {doc.kind}
                      </span>
                    </div>
                    {doc.excerpt && (
                      <div className="mt-1 line-clamp-2 text-xs leading-relaxed" style={{ color: t.muted }}>
                        {doc.excerpt}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}

        {docs.length === 0 && (
          <div className="py-16 text-center text-sm" style={{ color: t.muted }}>
            No published articles yet.
          </div>
        )}
      </div>

      {/* doc reader overlay */}
      {reader && (
        <div
          className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-10"
          onClick={() => setReader(null)}
        >
          <div
            className="w-full max-w-[720px] rounded-2xl p-7"
            style={{ background: t.card, color: t.text }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div>
                <div className="font-mono text-[9.5px] uppercase tracking-[0.1em]" style={{ color: accent }}>
                  {reader.source}
                </div>
                <h2 className="mt-1 text-[20px] font-bold leading-snug">{reader.title}</h2>
              </div>
              <button
                onClick={() => setReader(null)}
                className="ml-auto flex-none rounded-lg px-2 py-1 text-sm"
                style={{ color: t.muted }}
              >
                ✕
              </button>
            </div>
            <div
              className="mt-4 whitespace-pre-wrap text-[13px] leading-[1.75]"
              style={{ color: config.theme === "dark" ? "#cdd7db" : "#2a343a" }}
            >
              {reader.content}
            </div>
          </div>
        </div>
      )}

      {/* Ask AI */}
      {config.showAsk && (
        <>
          <button
            onClick={() => setAskOpen((v) => !v)}
            className="fixed bottom-5 right-5 z-50 flex h-[52px] items-center gap-2 rounded-full px-5 text-[13px] font-semibold text-white shadow-[0_8px_28px_rgba(0,0,0,0.3)] transition-transform hover:scale-105"
            style={{ background: accent }}
          >
            ✦ {askOpen ? "Close" : "Ask AI"}
          </button>
          {askOpen && (
            <div className="fixed bottom-[76px] right-5 z-50 h-[520px] w-[370px] max-w-[calc(100vw-40px)] overflow-hidden rounded-2xl shadow-[0_16px_56px_rgba(0,0,0,0.35)]">
              <WidgetChat
                config={{
                  name: config.title,
                  greeting: "Hi! Ask me anything about these docs — I'll answer with sources.",
                  color: accent,
                  showCitations: true,
                  suggestions: [],
                }}
                surface="kb"
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
