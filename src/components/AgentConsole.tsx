"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TopStrip } from "@/components/Shell";
import { Icon } from "@/components/Icons";

type Repo = { id: string; name: string; recipe: string };
type Agent = {
  id: string; name: string; online: boolean; outdated: boolean; minVersion: string;
  lastSeenAt: string | null; capabilities: string[]; repos: Repo[]; version: string | null;
};

const load = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
};
const save = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* per-viewer convenience only */
  }
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

/**
 * An agent's console, embedded and tunnelled to the laptop it runs on:
 *   view "console" — the Release Console (Pipeline, Library, Builds, Changes, History, Setup)
 *   view "agent"   — free-prompt Claude Code sessions in the repo, like the terminal
 *   view "marketing" — promo videos for the repo's product, made by Claude Code sessions
 */
export function AgentConsole({ view, title }: { view: "console" | "agent" | "marketing"; title: string }) {
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [agentId, setAgentId] = useState("");
  const [repoId, setRepoId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const loadAgents = useCallback(async () => {
    const { agents } = await api<{ agents: Agent[] }>("/api/releases");
    setAgents(agents);
    return agents;
  }, []);

  useEffect(() => {
    api<{ agents: Agent[] }>("/api/releases")
      .then(({ agents: list }) => {
        setAgents(list);
        const saved = load<{ agentId?: string; repoId?: string }>("releases:selection", {});
        const a = list.find((x) => x.id === saved.agentId) ?? list.find((x) => x.online) ?? list[0];
        if (!a) return;
        setAgentId(a.id);
        setRepoId((a.repos.find((x) => x.id === saved.repoId) ?? a.repos[0])?.id ?? "");
      })
      .catch((e) => setError(e.message));
    const t = setInterval(() => loadAgents().catch(() => {}), 15000);
    return () => clearInterval(t);
  }, [loadAgents]);

  useEffect(() => {
    if (agentId) save("releases:selection", { agentId, repoId });
  }, [agentId, repoId]);

  const agent = agents?.find((a) => a.id === agentId) ?? null;
  const repo = agent?.repos.find((r) => r.id === repoId) ?? null;
  const consoleUrl =
    agent && repo
      ? `/release-console/index.html?${view === "console" ? "" : `view=${view}&`}api=${encodeURIComponent(`/api/releases/console/${agent.id}/${repo.id}`)}`
      : null;

  // the console follows the app's light/dark toggle (same origin, so set it directly)
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const apply = () => {
      const doc = frame.current?.contentDocument;
      if (doc?.documentElement) doc.documentElement.dataset.theme = document.documentElement.classList.contains("dark") ? "dark" : "light";
    };
    const observer = new MutationObserver(apply);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    const el = frame.current;
    el?.addEventListener("load", apply);
    apply();
    return () => {
      observer.disconnect();
      el?.removeEventListener("load", apply);
    };
  }, [consoleUrl]);

  return (
    <>
      <TopStrip
        crumb={`Nonaki / ${title}${repo ? ` / ${repo.name}` : ""}`}
        right={
          agent ? (
            <span className={agent.online ? "text-green" : "text-amber"}>
              {agent.name.toUpperCase()} {agent.online ? "ONLINE" : "OFFLINE"}
            </span>
          ) : (
            <span>NO AGENT</span>
          )
        }
      />

      {agents && agents.length > 0 && (
        <div className="flex flex-none flex-wrap items-center gap-2 border-b border-hairline px-6 py-2">
          <Icon name={view === "agent" ? "terminal" : view === "marketing" ? "video" : "rocket"} size={14} className="text-muted" />
          <select
            value={agentId}
            onChange={(e) => {
              setAgentId(e.target.value);
              setRepoId(agents.find((a) => a.id === e.target.value)?.repos[0]?.id ?? "");
            }}
            className="rounded-[7px] border border-line bg-card px-2.5 py-1 text-[12px] outline-none focus:border-teal"
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.online ? "● " : "○ "}
                {a.name}
              </option>
            ))}
          </select>
          <select
            value={repoId}
            onChange={(e) => setRepoId(e.target.value)}
            className="rounded-[7px] border border-line bg-card px-2.5 py-1 text-[12px] outline-none focus:border-teal"
          >
            {(agent?.repos ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <span className="text-[11px] text-muted">
            runs on {agent?.name ?? "—"}
            {agent?.capabilities.length ? ` · ${agent.capabilities.join(" · ")}` : ""}
          </span>
        </div>
      )}

      {error && (
        <div className="mx-6 mt-3 rounded-lg border border-warn-line bg-warn-bg px-3 py-2 text-[12px] text-warn-text">{error}</div>
      )}

      {agents === null ? (
        <div className="p-7 text-xs text-muted">Loading…</div>
      ) : agents.length === 0 ? (
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin p-7">
          <div className="flex items-baseline gap-2.5">
            <h1 className="text-[21px] font-semibold tracking-[-0.01em]">{title}</h1>
            <span className="text-xs text-muted">
              {view === "agent" ? "Claude Code on your laptop, from here" : view === "marketing" ? "make promo videos with AI on your laptop, from here" : "run release stages on your laptop, from here"}
            </span>
          </div>
          <ConnectAgent onPaired={loadAgents} />
        </div>
      ) : !agent?.online ? (
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin p-7">
          <div className="max-w-[760px] rounded-xl border border-warn-line bg-warn-bg p-4 text-[12.5px] text-warn-text">
            <b>{agent?.name}</b> is offline{agent?.lastSeenAt ? ` (last seen ${new Date(agent.lastSeenAt).toLocaleString()})` : ""}. Start it on that machine:
            <CommandBlock command="release-agent start" className="mt-2" />
          </div>
          <AgentsFooter agents={agents} onChange={loadAgents} />
        </div>
      ) : agent.outdated ? (
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin p-7">
          <UpdateAgent agent={agent} />
        </div>
      ) : !repo ? (
        <div className="p-7 text-[12.5px] text-muted">
          {agent.name} serves no repos yet. On that machine: <code className="font-mono">release-agent add-repo &lt;path&gt; --recipe &lt;name&gt;</code>, then restart it.
        </div>
      ) : (
        <>
          <iframe ref={frame} key={consoleUrl!} src={consoleUrl!} title={`${title} — ${repo.name}`} className="min-h-0 w-full flex-1 border-0 bg-white" />
          <div className="flex-none border-t border-hairline px-6 py-1.5">
            <AgentsFooter agents={agents} onChange={loadAgents} compact />
          </div>
        </>
      )}
    </>
  );
}

/** A terminal command with a Copy button. */
function CommandBlock({ command, className = "" }: { command: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      // clipboard API blocked (e.g. plain http on a non-localhost host): fall back to a hidden textarea
      const ta = document.createElement("textarea");
      ta.value = command;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div className={`flex items-start gap-2 rounded-lg bg-ink p-2.5 ${className}`}>
      <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-[#7fd1de]">{command}</pre>
      <button
        onClick={copy}
        title="Copy command"
        className={`flex-none rounded-md border px-2 py-0.5 text-[10.5px] font-semibold transition-colors ${
          copied ? "border-green bg-green text-white" : "border-white/20 text-white/70 hover:border-white/50 hover:text-white"
        }`}
      >
        {copied ? "Copied ✓" : "Copy"}
      </button>
    </div>
  );
}

function ConnectAgent({ onPaired }: { onPaired: () => Promise<unknown> }) {
  const [code, setCode] = useState<{ code: string; expiresAt: string; origin: string } | null>(null);
  useEffect(() => {
    if (!code) return;
    const t = setInterval(() => onPaired(), 3000);
    return () => clearInterval(t);
  }, [code, onPaired]);

  const steps = code
    ? [
        [
          "Install the agent on your laptop (once — needs Node.js 20 or newer). It downloads from this server; the link works while the code is valid:",
          `npm install -g "${code.origin}/api/agent/download?code=${code.code}"`,
        ],
        ["Pair your laptop with this server:", `release-agent pair ${code.code} --server ${code.origin}`],
        [
          "Tell it which repo to release, and its recipe (run `release-agent recipes` to see the built-in ones):",
          `release-agent add-repo "/path/to/wp-simple-pay-pro" --recipe wpsp-pro`,
        ],
        ["Start it, and leave it running while you release:", "release-agent start"],
      ]
    : [];

  return (
    <div className="mt-4 max-w-[760px] rounded-xl border border-teal-line bg-teal-mist p-5">
      <div className="text-[14px] font-semibold">Connect your laptop</div>
      <p className="mt-1 text-[12px] leading-5 text-muted">
        Release stages run on your laptop — where your repos, git, gh and Claude login are — and you control them from here. You only install a small agent on the laptop (from this server); the agent connects out to this server, so nothing on your laptop is exposed.
      </p>
      {!code ? (
        <button
          onClick={async () => {
            const made = await api<{ code: string; expiresAt: string }>("/api/releases/pairing", { method: "POST" });
            setCode({ ...made, origin: window.location.origin });
          }}
          className="mt-3 rounded-md bg-teal px-3.5 py-1.5 text-[12px] font-semibold text-white hover:bg-teal-dark"
        >
          Make a pairing code
        </button>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="font-mono text-[22px] font-bold tracking-[0.15em] text-teal-dark">{code.code}</div>
          {steps.map(([label, cmd], i) => (
            <div key={i}>
              <div className="text-[11.5px] text-slate">
                {i + 1}. {label}
              </div>
              <CommandBlock command={cmd} className="mt-1" />
            </div>
          ))}
          <div className="text-[11px] text-muted">This page updates by itself once the agent connects.</div>
        </div>
      )}
    </div>
  );
}

function AgentsFooter({ agents, onChange, compact }: { agents: Agent[]; onChange: () => Promise<unknown>; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={compact ? "" : "mt-8"}>
      <button onClick={() => setOpen(!open)} className="font-mono text-[10px] tracking-[0.08em] text-muted hover:text-teal">
        {open ? "▾" : "▸"} AGENTS ({agents.length})
      </button>
      {open && (
        <div className="mt-2 max-w-[760px] space-y-2">
          {agents.map((a) => (
            <div key={a.id} className="flex items-center gap-3 rounded-xl border border-line bg-card px-4 py-2.5 text-[12px]">
              <span className={`h-2 w-2 flex-none rounded-full ${a.online ? "bg-green" : "bg-ghost"}`} />
              <span className="font-semibold">{a.name}</span>
              <span className="text-muted">{a.repos.map((r) => r.name).join(", ") || "no repos"}</span>
              <span className="font-mono text-[10px] text-faint">{a.capabilities.join(" · ")}</span>
              <button
                onClick={async () => {
                  await api(`/api/releases/agents/${a.id}`, { method: "DELETE" });
                  await onChange();
                }}
                className="ml-auto rounded-md border border-edge px-2 py-0.5 text-[11px] text-muted hover:border-diff-del-line hover:text-diff-del-line"
              >
                Unpair
              </button>
            </div>
          ))}
          <ConnectAgent onPaired={onChange} />
        </div>
      )}
    </div>
  );
}

/** The agent on the laptop is too old for the console: how to update it. */
function UpdateAgent({ agent }: { agent: Agent }) {
  const [link, setLink] = useState<string | null>(null);
  return (
    <div className="max-w-[760px] rounded-xl border border-warn-line bg-warn-bg p-5 text-[12.5px] text-warn-text">
      <div className="text-[14px] font-semibold">Update the agent on {agent.name}</div>
      <p className="mt-1 leading-5">
        It runs release-agent {agent.version ?? "(unknown)"}; the console needs {agent.minVersion} or newer. Your pairing and repos are kept — just
        install the new version and restart it.
      </p>
      {!link ? (
        <button
          onClick={async () => {
            const made = await api<{ code: string }>("/api/releases/pairing", { method: "POST" });
            setLink(`${window.location.origin}/api/agent/download?code=${made.code}`);
          }}
          className="mt-3 rounded-md bg-teal px-3.5 py-1.5 text-[12px] font-semibold text-white hover:bg-teal-dark"
        >
          Show the update commands
        </button>
      ) : (
        <div className="mt-3 space-y-3">
          <div>
            <div className="text-[11.5px]">1. Stop the running agent (Ctrl-C in its terminal), then install the new version:</div>
            <CommandBlock command={`npm install -g "${link}"`} className="mt-1" />
          </div>
          <div>
            <div className="text-[11.5px]">2. Start it again:</div>
            <CommandBlock command="release-agent start" className="mt-1" />
          </div>
          <div className="text-[11px] opacity-80">From then on, <code className="font-mono">release-agent update</code> updates it in one step.</div>
        </div>
      )}
    </div>
  );
}
