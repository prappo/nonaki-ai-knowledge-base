"use client";

import { useEffect, useRef, useState } from "react";

export type WidgetChatConfig = {
  name: string;
  greeting: string;
  color: string;
  showCitations: boolean;
  suggestions: string[];
};

type Citation = { n: number; title: string; sourceType: string; url?: string | null };
type Msg = {
  role: "user" | "bot";
  text: string;
  citations?: Citation[];
  streaming?: boolean;
};

/**
 * The chat conversation UI — used by the /embed/widget page (real visitors)
 * and rendered inline as the live preview in the builder.
 */
export function WidgetChat({
  config,
  surface = "widget",
}: {
  config: WidgetChatConfig;
  surface?: "widget" | "kb";
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function ask(q?: string) {
    const question = (q ?? input).trim();
    if (!question || busy) return;
    setInput("");
    setBusy(true);
    setMessages((m) => [
      ...m,
      { role: "user", text: question },
      { role: "bot", text: "", streaming: true },
    ]);

    const patchLast = (patch: Partial<Msg>) =>
      setMessages((m) => {
        const next = [...m];
        next[next.length - 1] = { ...next[next.length - 1], ...patch };
        return next;
      });

    try {
      const res = await fetch("/api/embed/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, surface }),
      });
      if (!res.ok || !res.body) throw new Error("Request failed");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let text = "";
      let citations: Citation[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const event = JSON.parse(line.slice(6));
          if (event.type === "meta") citations = event.citations;
          else if (event.type === "text") {
            text += event.text;
            patchLast({ text });
          } else if (event.type === "error") {
            text = text || event.error;
            patchLast({ text });
          }
        }
      }
      patchLast({
        streaming: false,
        citations: config.showCitations ? citations : undefined,
      });
    } catch {
      patchLast({ streaming: false, text: "Something went wrong — please try again." });
    } finally {
      setBusy(false);
    }
  }

  const color = config.color || "#0e7f93";

  return (
    <div className="flex h-full flex-col bg-white text-[#1c2429]">
      {/* header */}
      <div
        className="flex flex-none items-center gap-2.5 px-4 py-3 text-white"
        style={{ background: color }}
      >
        <span className="grid h-7 w-7 place-items-center rounded-full bg-white/20 text-[13px]">
          ✦
        </span>
        <div className="leading-tight">
          <div className="text-[13px] font-bold">{config.name}</div>
          <div className="text-[10px] opacity-80">AI · answers from our knowledge base</div>
        </div>
        <span className="ml-auto flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[9px] font-semibold">
          <span className="h-1.5 w-1.5 rounded-full bg-[#7dffc4]" /> Online
        </span>
      </div>

      {/* messages */}
      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3.5 py-3.5">
        <div className="max-w-[85%] rounded-xl rounded-bl-[4px] bg-[#f1f4f5] px-3 py-2 text-xs leading-[1.55]">
          {config.greeting}
        </div>

        {messages.length === 0 &&
          config.suggestions.filter(Boolean).map((s) => (
            <button
              key={s}
              onClick={() => ask(s)}
              className="block rounded-full border px-3 py-1.5 text-[11px] transition-colors"
              style={{ borderColor: color, color }}
            >
              {s}
            </button>
          ))}

        {messages.map((m, i) =>
          m.role === "user" ? (
            <div
              key={i}
              className="ml-auto w-fit max-w-[85%] rounded-xl rounded-br-[4px] px-3 py-2 text-xs leading-[1.55] text-white"
              style={{ background: color }}
            >
              {m.text}
            </div>
          ) : (
            <div
              key={i}
              className="max-w-[88%] rounded-xl rounded-bl-[4px] bg-[#f1f4f5] px-3 py-2 text-xs leading-[1.6]"
            >
              <BotText text={m.text} color={color} />
              {m.streaming && (
                <span
                  className="ml-1 inline-block h-3 w-0.5 animate-pulse align-middle"
                  style={{ background: color }}
                />
              )}
              {m.citations && m.citations.length > 0 && (
                <div className="mt-1.5 space-y-0.5 border-t border-black/5 pt-1.5 text-[9.5px] text-[#7c8b90]">
                  {m.citations.slice(0, 3).map((c) => (
                    <div key={c.n} className="flex min-w-0 items-center gap-1">
                      <span className="flex-none" style={{ color }}>
                        [{c.n}]
                      </span>
                      {c.url ? (
                        <a
                          href={c.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-w-0 items-center gap-0.5 hover:underline"
                          style={{ color }}
                          title={c.url}
                        >
                          <span className="truncate">{c.title}</span>
                          <svg
                            width="9"
                            height="9"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="flex-none"
                          >
                            <path d="M7 17L17 7" />
                            <path d="M8 7h9v9" />
                          </svg>
                        </a>
                      ) : (
                        <span className="truncate">{c.title}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        )}
        <div ref={endRef} />
      </div>

      {/* input */}
      <div className="flex-none border-t border-black/10 p-2.5">
        <div className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-1.5">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && ask()}
            placeholder="Type your question…"
            className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-[#9aa6ab]"
          />
          <button
            onClick={() => ask()}
            disabled={busy || !input.trim()}
            className="grid h-6 w-6 flex-none place-items-center rounded-full text-white disabled:opacity-40"
            style={{ background: color }}
            title="Send"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 2L11 13" />
              <path d="M22 2l-7 20-4-9-9-4 20-7z" />
            </svg>
          </button>
        </div>
        <div className="mt-1.5 text-center text-[8.5px] text-[#b5bfc3]">
          Powered by Nonaki · answers may be AI-generated
        </div>
      </div>
    </div>
  );
}

function BotText({ text, color }: { text: string; color: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\[\d+\])/g);
  return (
    <span className="whitespace-pre-wrap">
      {parts.map((part, i) => {
        if (/^\*\*[^*]+\*\*$/.test(part)) return <b key={i}>{part.slice(2, -2)}</b>;
        if (/^\[\d+\]$/.test(part))
          return (
            <sup key={i} className="font-mono text-[8.5px]" style={{ color }}>
              {part}
            </sup>
          );
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}
