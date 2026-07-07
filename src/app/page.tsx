"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { TopStrip, useStats } from "@/components/Shell";
import { SourceIcon } from "@/components/SourceIcon";

type Citation = {
  n: number;
  documentId: string;
  title: string;
  sourceType: string;
  url: string;
  snippet?: string;
  chunkIndex?: number;
  chunksUsed?: number;
};

type SearchResult = {
  content: string;
  title: string;
  documentId: string;
  sourceType: string;
  url: string;
  score: number;
};

type SourceInfo = { id: string; name: string; type: string; siteUrl?: string };

const QUICK_PROMPTS = [
  "Summarize what's in the knowledge base",
  "What topics are covered?",
  "What changed recently?",
];

type RetrievalMode = "hybrid" | "semantic" | "keyword";

const RETRIEVAL_MODES: { id: RetrievalMode; label: string; hint: string }[] = [
  {
    id: "hybrid",
    label: "Hybrid",
    hint: "Meaning + keywords — best for most questions",
  },
  {
    id: "semantic",
    label: "Semantic",
    hint: "Vector similarity only — ask in your own words",
  },
  {
    id: "keyword",
    label: "Keyword",
    hint: "Exact term matching (BM25) — names, codes, errors",
  },
];

export default function ConsolePage() {
  const { stats } = useStats();
  const [question, setQuestion] = useState("");
  const [mode, setMode] = useState<"idle" | "asking" | "answered" | "searching" | "searched">("idle");
  const [answer, setAnswer] = useState("");
  const [citations, setCitations] = useState<Citation[]>([]);
  const [confidence, setConfidence] = useState(0);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  // source scope — all sources selected by default
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [scopeIds, setScopeIds] = useState<Set<string>>(new Set());
  const [scopeOpen, setScopeOpen] = useState(false);
  const scopeRef = useRef<HTMLDivElement>(null);

  // retrieval strategy
  const [retrieval, setRetrieval] = useState<RetrievalMode>("hybrid");
  const [retrievalOpen, setRetrievalOpen] = useState(false);
  const retrievalRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    fetch("/api/sources")
      .then((r) => r.json())
      .then((d) => {
        const list: SourceInfo[] = (d.sources ?? []).map(
          (s: { id: string; name: string; type: string; config: string | null }) => {
            let siteUrl: string | undefined;
            try {
              siteUrl = (JSON.parse(s.config ?? "{}") as { url?: string }).url;
            } catch {
              siteUrl = undefined;
            }
            return { id: s.id, name: s.name, type: s.type, siteUrl };
          }
        );
        setSources(list);
        setScopeIds(new Set(list.map((s) => s.id))); // default: all
      })
      .catch(() => {});
  }, []);

  // close popovers on outside click
  useEffect(() => {
    if (!scopeOpen && !retrievalOpen) return;
    const onDown = (e: MouseEvent) => {
      if (scopeOpen && scopeRef.current && !scopeRef.current.contains(e.target as Node)) {
        setScopeOpen(false);
      }
      if (
        retrievalOpen &&
        retrievalRef.current &&
        !retrievalRef.current.contains(e.target as Node)
      ) {
        setRetrievalOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [scopeOpen, retrievalOpen]);

  const allSelected = sources.length > 0 && scopeIds.size >= sources.length;
  const selectedSources = sources.filter((s) => scopeIds.has(s.id));
  const scopeStack = selectedSources.slice(0, 4);
  const scopeOverflow = selectedSources.length - scopeStack.length;

  const scopePayload = () =>
    allSelected || scopeIds.size === 0 ? {} : { sourceIds: [...scopeIds] };

  function toggleScope(id: string) {
    setScopeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function ask(q?: string) {
    const query = (q ?? question).trim();
    if (!query) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setAsked(query);
    setQuestion(query);
    setMode("asking");
    setAnswer("");
    setCitations([]);
    setConfidence(0);
    setError(null);
    setResults([]);

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: query, retrieval, ...scopePayload() }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const event = JSON.parse(line.slice(6));
          if (event.type === "meta") {
            setCitations(event.citations);
            setConfidence(event.confidence);
          } else if (event.type === "text") {
            setAnswer((prev) => prev + event.text);
          } else if (event.type === "error") {
            setError(event.error);
          }
        }
      }
      setMode("answered");
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Something went wrong");
      setMode("answered");
    }
  }

  async function search() {
    const query = question.trim();
    if (!query) return;
    setAsked(query);
    setMode("searching");
    setError(null);
    setAnswer("");
    setCitations([]);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, retrieval, ...scopePayload() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Search failed");
      setResults(data.results);
      setMode("searched");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
      setMode("searched");
    }
  }

  const busy = mode === "asking" || mode === "searching";

  return (
    <>
      <TopStrip crumb="Nonaki / Ask" />
      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto scrollbar-thin px-6 pt-11 pb-10">
        <div className="font-mono text-[11px] tracking-[0.14em] text-teal">
          NONAKI / ASK
        </div>
        <h1 className="mt-2.5 text-[29px] font-semibold tracking-[-0.015em]">
          What do you need to know?
        </h1>

        {/* ask box */}
        <div className="mt-5 w-[680px] max-w-full rounded-xl border-[1.5px] border-teal bg-card px-[18px] py-4 shadow-[0_4px_16px_rgba(14,127,147,0.10)]">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                ask();
              }
            }}
            placeholder="Ask anything about your knowledge base…"
            rows={1}
            className="w-full resize-none bg-transparent text-[14.5px] text-ink outline-none placeholder:text-faint"
          />
          <div className="mt-3 flex items-center gap-2">
            <div ref={scopeRef} className="relative">
              <button
                onClick={() => setScopeOpen((v) => !v)}
                title={
                  selectedSources.length > 0
                    ? selectedSources.map((s) => s.name).join(" · ")
                    : undefined
                }
                className={`flex h-[26px] items-center gap-1.5 rounded-full border pl-2.5 pr-2 transition-colors ${
                  scopeOpen || !allSelected
                    ? "border-teal bg-teal-soft text-teal-dark"
                    : "border-line text-muted hover:border-teal hover:text-teal"
                }`}
              >
                <span className="font-mono text-[9.5px] tracking-[0.05em]">FROM</span>
                {sources.length === 0 ? (
                  <span className="font-mono text-[10px]">NO SOURCES</span>
                ) : scopeIds.size === 0 ? (
                  <span className="font-mono text-[10px] text-orange">NONE</span>
                ) : (
                  <span className="flex items-center pl-0.5">
                    {scopeStack.map((s, i) => (
                      <span
                        key={s.id}
                        className={`rounded-full ring-2 ring-card ${i > 0 ? "-ml-1.5" : ""}`}
                        style={{ zIndex: scopeStack.length - i }}
                      >
                        <SourceIcon type={s.type} siteUrl={s.siteUrl} size={18} rounded="full" />
                      </span>
                    ))}
                    {scopeOverflow > 0 && (
                      <span className="z-0 -ml-1.5 grid h-[18px] w-[18px] place-items-center rounded-full bg-chip font-mono text-[8px] font-bold text-muted ring-2 ring-card">
                        +{scopeOverflow}
                      </span>
                    )}
                  </span>
                )}
                {allSelected && (
                  <span className="font-mono text-[9px] text-faint">ALL</span>
                )}
                <span className="text-[8px]">▾</span>
              </button>
              {scopeOpen && (
                <div className="absolute left-0 top-[calc(100%+6px)] z-30 w-72 overflow-hidden rounded-xl border border-line bg-card shadow-[0_12px_36px_rgba(10,20,25,0.16)]">
                  <div className="flex items-center border-b border-hairline bg-panel px-3.5 py-2">
                    <span className="font-mono text-[9px] tracking-[0.08em] text-muted">
                      ANSWER FROM
                    </span>
                    <button
                      onClick={() =>
                        setScopeIds(
                          allSelected ? new Set() : new Set(sources.map((s) => s.id))
                        )
                      }
                      className="ml-auto text-[10.5px] font-semibold text-teal hover:text-teal-dark"
                    >
                      {allSelected ? "Clear all" : "Select all"}
                    </button>
                  </div>
                  <div className="max-h-60 overflow-y-auto scrollbar-thin">
                    {sources.map((s) => (
                      <label
                        key={s.id}
                        className={`flex cursor-pointer items-center gap-2.5 border-b border-row-line px-3.5 py-2 text-xs last:border-0 hover:bg-hover ${
                          scopeIds.has(s.id) ? "" : "opacity-55"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={scopeIds.has(s.id)}
                          onChange={() => toggleScope(s.id)}
                          className="h-3.5 w-3.5 flex-none accent-[#0e7f93]"
                        />
                        <SourceIcon type={s.type} siteUrl={s.siteUrl} size={22} />
                        <span className="min-w-0 flex-1 truncate font-semibold">{s.name}</span>
                        <span className="flex-none font-mono text-[8.5px] uppercase text-faint">
                          {s.type}
                        </span>
                      </label>
                    ))}
                    {sources.length === 0 && (
                      <div className="px-3.5 py-3 text-[11px] text-muted">
                        No sources connected yet.
                      </div>
                    )}
                  </div>
                  <div
                    className={`border-t border-hairline px-3.5 py-1.5 text-[10.5px] ${
                      scopeIds.size === 0 && sources.length > 0
                        ? "bg-warn-bg text-warn-text"
                        : "bg-panel text-faint"
                    }`}
                  >
                    {scopeIds.size === 0 && sources.length > 0
                      ? "Nothing selected — answers will find no sources."
                      : allSelected
                        ? `Answering from all ${sources.length} sources.`
                        : `Answering from ${scopeIds.size} of ${sources.length} sources.`}
                  </div>
                </div>
              )}
            </div>

            <div ref={retrievalRef} className="relative">
              <button
                onClick={() => setRetrievalOpen((v) => !v)}
                className={`flex h-[26px] items-center gap-1.5 rounded-full border px-2.5 font-mono text-[10px] transition-colors ${
                  retrievalOpen || retrieval !== "hybrid"
                    ? "border-teal bg-teal-soft text-teal-dark"
                    : "border-line text-muted hover:border-teal hover:text-teal"
                }`}
              >
                <span className="tracking-[0.05em]">
                  {retrieval.toUpperCase()} RETRIEVAL
                </span>
                <span className="text-[8px]">▾</span>
              </button>
              {retrievalOpen && (
                <div className="absolute left-0 top-[calc(100%+6px)] z-30 w-72 overflow-hidden rounded-xl border border-line bg-card shadow-[0_12px_36px_rgba(10,20,25,0.16)]">
                  <div className="border-b border-hairline bg-panel px-3.5 py-2 font-mono text-[9px] tracking-[0.08em] text-muted">
                    HOW TO SEARCH THE INDEX
                  </div>
                  {RETRIEVAL_MODES.map((m, i) => (
                    <button
                      key={m.id}
                      onClick={() => {
                        setRetrieval(m.id);
                        setRetrievalOpen(false);
                      }}
                      className={`flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left hover:bg-hover ${
                        i < RETRIEVAL_MODES.length - 1 ? "border-b border-row-line" : ""
                      }`}
                    >
                      <span
                        className={`mt-[3px] grid h-3.5 w-3.5 flex-none place-items-center rounded-full border ${
                          retrieval === m.id ? "border-teal bg-teal" : "border-edge"
                        }`}
                      >
                        {retrieval === m.id && (
                          <span className="h-1.5 w-1.5 rounded-full bg-white" />
                        )}
                      </span>
                      <span className="min-w-0">
                        <span
                          className={`block text-xs ${
                            retrieval === m.id ? "font-semibold text-teal-dark" : "font-semibold"
                          }`}
                        >
                          {m.label}
                          {m.id === "hybrid" && (
                            <span className="ml-1.5 rounded bg-teal-soft px-1.5 py-px font-mono text-[8px] font-normal uppercase text-teal-dark">
                              recommended
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 block text-[10.5px] leading-snug text-muted">
                          {m.hint}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <span className="ml-auto flex items-center gap-2">
              <button
                onClick={search}
                disabled={busy || !question.trim()}
                className="inline-flex items-center gap-1.5 rounded-[7px] border border-teal-line bg-card px-3.5 py-1.5 text-xs font-semibold text-teal transition-colors hover:bg-teal-soft disabled:opacity-50"
              >
                <span className="inline-block h-[9px] w-[9px] rounded-full border-[1.5px] border-current" />
                Search
              </button>
              <button
                onClick={() => ask()}
                disabled={busy || !question.trim()}
                className="rounded-[7px] bg-teal px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-teal-dark disabled:opacity-50"
              >
                {mode === "asking" ? "Thinking…" : "Ask ↵"}
              </button>
            </span>
          </div>
        </div>

        {/* quick prompts */}
        {mode === "idle" && (
          <div className="mt-3 flex w-[680px] max-w-full flex-wrap gap-2">
            {QUICK_PROMPTS.map((p) => (
              <button
                key={p}
                onClick={() => ask(p)}
                className="rounded-full border border-edge bg-card px-3 py-[5px] text-[11.5px] text-slate transition-colors hover:border-teal hover:text-teal"
              >
                {p}
              </button>
            ))}
          </div>
        )}

        {/* empty-base hint */}
        {mode === "idle" && stats.docs === 0 && (
          <div className="mt-8 flex w-[680px] max-w-full items-center gap-3 rounded-[9px] border border-warn-line bg-warn-bg px-4 py-3 text-xs leading-relaxed text-warn-text">
            <span className="h-2 w-2 flex-none rounded-full bg-orange" />
            <div>
              <b>Your knowledge base is empty.</b> Connect a WordPress site or
              upload PDF / DOCX files to start asking questions.
            </div>
            <Link
              href="/sources"
              className="ml-auto flex-none text-[11.5px] font-semibold text-teal hover:text-teal-dark"
            >
              Add a source →
            </Link>
          </div>
        )}

        {error && (
          <div className="mt-6 w-[820px] max-w-full rounded-xl border border-warn-line bg-warn-bg px-4 py-3 text-xs text-warn-text">
            <b>Something went wrong:</b> {error}
          </div>
        )}

        {/* answer card */}
        {(mode === "asking" || mode === "answered") && !error && (
          <div className="mt-6 w-[820px] max-w-full shrink-0 overflow-hidden rounded-xl border border-line bg-card shadow-[0_1px_4px_rgba(20,40,45,0.05)]">
            <div className="flex items-center gap-2 border-b border-hairline-2 px-[18px] py-[11px] font-mono text-[10px] tracking-[0.05em] text-muted">
              <span className={`text-teal ${mode === "asking" ? "pulse-dot" : ""}`}>
                ● ANSWER
              </span>
              <span>
                {citations.length > 0
                  ? `FROM ${citations.length} SOURCE${citations.length > 1 ? "S" : ""}`
                  : "SEARCHING THE BASE"}
              </span>
              <span className="ml-auto flex items-center gap-1.5">
                CONFIDENCE
                <span className="inline-flex gap-0.5">
                  {[1, 2, 3, 4].map((i) => (
                    <span
                      key={i}
                      className={`h-[5px] w-3.5 rounded-sm ${
                        i <= confidence ? "bg-teal" : "bg-edge"
                      }`}
                    />
                  ))}
                </span>
              </span>
            </div>
            <div className="flex flex-col sm:flex-row">
              <div className="min-w-0 flex-1 px-5 py-4 text-[13px] leading-[1.65] text-body">
                <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.05em] text-faint">
                  {asked}
                </div>
                <AnswerText text={answer} streaming={mode === "asking"} />
              </div>
              {citations.length > 0 && (
                <div className="w-full flex-none border-t border-hairline-2 bg-panel px-4 py-3.5 sm:w-[270px] sm:border-l sm:border-t-0">
                  <div className="flex flex-col gap-2.5">
                    {citations.map((c) => (
                      <CitationCard key={c.n} citation={c} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* search results */}
        {(mode === "searching" || mode === "searched") && !error && (
          <div className="mt-6 w-[820px] max-w-full shrink-0">
            <div className="mb-2 font-mono text-[10px] tracking-[0.08em] text-muted">
              {mode === "searching"
                ? "SEARCHING…"
                : `${results.length} MATCHING CHUNKS · RANKED BY HYBRID SCORE`}
            </div>
            <div className="flex flex-col gap-2">
              {results.map((r, i) => (
                <Link
                  key={i}
                  href={`/docs/${r.documentId}`}
                  className="rounded-[9px] border border-hairline bg-card px-4 py-3 transition-colors hover:border-teal-line hover:bg-hover"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[12.5px] font-semibold">{r.title}</span>
                    <span className="rounded bg-chip px-1.5 py-0.5 font-mono text-[9px] uppercase text-muted">
                      {r.sourceType}
                    </span>
                    <span className="ml-auto font-mono text-[9.5px] text-faint">
                      {(r.score * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div className="mt-1 line-clamp-2 text-xs leading-relaxed text-dim">
                    {r.content}
                  </div>
                </Link>
              ))}
              {mode === "searched" && results.length === 0 && (
                <div className="rounded-[9px] border border-hairline bg-card px-4 py-6 text-center text-xs text-muted">
                  Nothing matched. Try different words, or add more sources.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/** Citation with an expandable preview of the exact chunk the answer used. */
function CitationCard({ citation: c }: { citation: Citation }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-[11.5px] leading-[1.4]">
      <div className="flex gap-2">
        <span className="flex-none font-mono text-[10px] text-teal">{c.n}</span>
        <div className="min-w-0 flex-1">
          <Link href={`/docs/${c.documentId}`} className="hover:text-teal">
            <b>{c.title}</b>
          </Link>
          <div className="mt-px flex items-center gap-1 text-muted">
            <span className="text-green">✓ indexed</span>·
            <span className="capitalize">{c.sourceType}</span>
            {c.snippet && (
              <button
                onClick={() => setOpen((v) => !v)}
                className="ml-auto flex-none font-mono text-[9px] uppercase text-teal hover:text-teal-dark"
              >
                {open ? "Hide" : "View"} passage {open ? "▴" : "▾"}
              </button>
            )}
          </div>
        </div>
      </div>
      {open && c.snippet && (
        <div className="mt-1.5 rounded-lg border border-hairline bg-card px-2.5 py-2">
          <div className="flex items-center gap-1.5 font-mono text-[8.5px] uppercase tracking-[0.06em] text-faint">
            Chunk {(c.chunkIndex ?? 0) + 1}
            {(c.chunksUsed ?? 1) > 1 ? ` · ${c.chunksUsed} chunks used` : ""}
            <Link
              href={`/docs/${c.documentId}`}
              className="ml-auto text-teal hover:text-teal-dark"
            >
              Open doc →
            </Link>
          </div>
          <div className="mt-1 whitespace-pre-wrap text-[10.5px] leading-[1.55] text-dim">
            {c.snippet}
          </div>
        </div>
      )}
    </div>
  );
}

/** Render **bold** + [n] citation markers from the streamed answer. */
function AnswerText({ text, streaming }: { text: string; streaming: boolean }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\[\d+\])/g);
  return (
    <p className="whitespace-pre-wrap">
      {parts.map((part, i) => {
        if (/^\*\*[^*]+\*\*$/.test(part)) {
          return <b key={i}>{part.slice(2, -2)}</b>;
        }
        if (/^\[\d+\]$/.test(part)) {
          return (
            <span
              key={i}
              className="mx-0.5 rounded bg-teal-soft px-1 font-mono text-[10px] text-teal"
            >
              {part.slice(1, -1)}
            </span>
          );
        }
        return <span key={i}>{part}</span>;
      })}
      {streaming && (
        <span className="cursor-blink ml-0.5 inline-block h-4 w-0.5 translate-y-[3px] bg-teal" />
      )}
    </p>
  );
}
