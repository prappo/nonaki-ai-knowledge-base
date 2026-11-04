"use client";

import { useEffect, useState } from "react";
import { TopStrip } from "@/components/Shell";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";

type Settings = Record<string, string>;

type ProviderInfo = {
  id: string;
  label: string;
  model: string;
  note: string;
  envKey: string;
  configured: boolean;
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({});
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setSettings(d.settings ?? {});
        setProviders(d.providers ?? []);
      });
  }, []);

  async function update(patch: Settings) {
    const prev = settings;
    setSettings({ ...settings, ...patch });
    setError(null);
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "Save failed");
      setSettings(prev);
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <>
      <TopStrip
        crumb="Nonaki / Settings"
        right={<span className={saved ? "text-green" : ""}>{saved ? "SAVED ✓" : "AUTO-SAVES"}</span>}
      />
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin p-7">
        <div className="max-w-[640px]">
          <h1 className="text-[21px] font-semibold tracking-[-0.01em]">Settings</h1>
          <p className="mt-0.5 text-[12.5px] text-muted">
            How content is chunked for the index and retrieved for answers.
            Changes save automatically.
          </p>

          {error && (
            <div className="mt-3 rounded-lg border border-warn-line bg-warn-bg px-3 py-2 text-[11.5px] text-warn-text">
              {error}
            </div>
          )}

          <div className="mt-5 font-mono text-[10px] tracking-[0.08em] text-muted">
            AI SERVICE PROVIDER
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2.5">
            {providers.map((p) => {
              const active = (settings.aiProvider ?? "groq") === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => p.configured && update({ aiProvider: p.id })}
                  disabled={!p.configured}
                  className={`rounded-xl border p-[14px] text-left transition-colors ${
                    active
                      ? "border-teal bg-teal-soft"
                      : p.configured
                        ? "border-line bg-card hover:border-teal"
                        : "cursor-not-allowed border-line bg-card opacity-60"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`grid h-4 w-4 flex-none place-items-center rounded-full border ${
                        active ? "border-teal bg-teal" : "border-ghost"
                      }`}
                    >
                      {active && (
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      )}
                    </span>
                    <span className={`text-[13px] font-semibold ${active ? "text-teal-dark" : ""}`}>
                      {p.label}
                    </span>
                    {p.configured ? (
                      <span className="ml-auto rounded-[5px] bg-green-soft px-1.5 py-0.5 text-[9.5px] font-semibold text-green">
                        KEY SET
                      </span>
                    ) : (
                      <span className="ml-auto rounded-[5px] bg-chip px-1.5 py-0.5 text-[9.5px] font-semibold text-muted">
                        NO KEY
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 font-mono text-[10.5px] text-slate">{p.model}</div>
                  <div className="mt-1 text-[11px] leading-[1.45] text-muted">
                    {p.configured ? p.note : `Add ${p.envKey} to .env to enable`}
                  </div>
                </button>
              );
            })}
          </div>
          <div className="mt-2.5 overflow-hidden rounded-xl border border-line bg-card">
            <div className="flex items-center gap-3.5 px-[18px] py-[15px]">
              <div className="min-w-0">
                <div className="text-[13px] font-semibold">Thinking mode</div>
                <div className="mt-0.5 text-[11.5px] leading-[1.45] text-muted">
                  Let the model reason before answering — better on hard questions, but
                  slower and uses more tokens. Applies to Claude, OpenAI and DeepSeek
                  models; Groq&apos;s default model doesn&apos;t support it.
                </div>
              </div>
              <div className="ml-auto flex flex-none gap-1.5">
                {(
                  [
                    ["false", "Off"],
                    ["true", "On"],
                  ] as const
                ).map(([v, label]) => (
                  <button
                    key={v}
                    onClick={() => update({ aiThinking: v })}
                    className={`rounded-md border px-[11px] py-[5px] text-[11.5px] ${
                      (settings.aiThinking ?? "false") === v
                        ? "border-teal bg-teal-soft font-semibold text-teal-dark"
                        : "border-edge text-muted hover:border-teal"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-faint">
            Used for answers, drafting and inline edits. Override the model with{" "}
            <span className="font-mono">GROQ_MODEL / OPENAI_MODEL / ANTHROPIC_MODEL / DEEPSEEK_MODEL</span>{" "}
            in <span className="font-mono">.env</span>.
          </p>

          <div className="mt-5 font-mono text-[10px] tracking-[0.08em] text-muted">
            CHUNKING &amp; RETRIEVAL
          </div>
          <div className="mt-2 overflow-hidden rounded-xl border border-line bg-card">
            <div className="flex items-center gap-3.5 border-b border-hairline-2 px-[18px] py-[15px]">
              <div className="min-w-0">
                <div className="text-[13px] font-semibold">Chunk size</div>
                <div className="mt-0.5 text-[11.5px] leading-[1.45] text-muted">
                  Characters per chunk for the LangChain RecursiveCharacterTextSplitter.
                  Applies to newly indexed or re-indexed content.
                </div>
              </div>
              <div className="ml-auto flex flex-none gap-1.5">
                {["800", "1200", "1600"].map((v) => (
                  <button
                    key={v}
                    onClick={() => update({ chunkSize: v })}
                    className={`rounded-md border px-[11px] py-[5px] text-[11.5px] ${
                      settings.chunkSize === v
                        ? "border-teal bg-teal-soft font-semibold text-teal-dark"
                        : "border-edge text-muted hover:border-teal"
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3.5 px-[18px] py-[15px]">
              <div className="min-w-0">
                <div className="text-[13px] font-semibold">Retrieval depth</div>
                <div className="mt-0.5 text-[11.5px] leading-[1.45] text-muted">
                  How many chunks hybrid search feeds into each answer — applies to
                  the console, chat widget, KB site and Messenger bot.
                </div>
              </div>
              <div className="ml-auto flex flex-none gap-1.5">
                {["4", "8", "12"].map((v) => (
                  <button
                    key={v}
                    onClick={() => update({ retrievalLimit: v })}
                    className={`rounded-md border px-[11px] py-[5px] text-[11.5px] ${
                      settings.retrievalLimit === v
                        ? "border-teal bg-teal-soft font-semibold text-teal-dark"
                        : "border-edge text-muted hover:border-teal"
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-5 font-mono text-[10px] tracking-[0.08em] text-muted">
            INFRASTRUCTURE — CONFIGURED VIA .ENV
          </div>
          <div className="mt-2 overflow-hidden rounded-xl border border-line bg-card">
            <InfraRow
              label="Vector database"
              value="Weaviate Cloud · text2vec-weaviate embeddings"
              env="WEAVIATE_URL / WEAVIATE_API_KEY"
            />
            <InfraRow
              label="Database & authentication"
              value="Supabase · Postgres (Prisma) + Supabase Auth"
              env="DATABASE_URL / NEXT_PUBLIC_SUPABASE_*"
              last
            />
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-faint">
            Credentials live in <span className="font-mono">.env</span> — they are never
            stored in the database or exposed to the browser.
          </p>

          <DataManagement />
        </div>
      </div>
    </>
  );
}

function InfraRow({
  label,
  value,
  env,
  last,
}: {
  label: string;
  value: string;
  env: string;
  last?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-3.5 px-[18px] py-[13px] ${
        last ? "" : "border-b border-hairline-2"
      }`}
    >
      <div className="min-w-0">
        <div className="text-[13px] font-semibold">{label}</div>
        <div className="mt-0.5 text-[11.5px] text-muted">{value}</div>
      </div>
      <span className="ml-auto flex-none rounded bg-chip px-2 py-1 font-mono text-[9px] text-muted">
        {env}
      </span>
    </div>
  );
}

type DataCounts = Record<string, number>;

type DataTarget = {
  id: string;
  label: string;
  description: string;
  /** What the confirm dialog warns will be lost. */
  warning: string;
  countLabel: (c: DataCounts) => string;
};

const DATA_TARGETS: DataTarget[] = [
  {
    id: "documents",
    label: "Documents",
    description:
      "Every document with its version history, review proposals and indexed chunks in Weaviate. Connected sources stay — re-sync to re-import.",
    warning:
      "Permanently deletes all documents (indexed and archived), their versions and proposals, and empties the Weaviate index.",
    countLabel: (c) => `${c.documents ?? 0} docs`,
  },
  {
    id: "proposals",
    label: "Review queue",
    description: "All change proposals — pending, approved and rejected. Documents are not changed.",
    warning: "Permanently deletes every proposal, including pending ones that haven't been reviewed.",
    countLabel: (c) => `${c.proposals ?? 0} (${c.pendingProposals ?? 0} pending)`,
  },
  {
    id: "projects",
    label: "Projects",
    description: "All projects with their tasks and document links. The linked documents themselves are kept.",
    warning: "Permanently deletes every project and all of its tasks.",
    countLabel: (c) => `${c.projects ?? 0} projects · ${c.projectTasks ?? 0} tasks`,
  },
  {
    id: "versions",
    label: "Version history",
    description: "Past snapshots of every document. Current content is kept; restoring older versions won't be possible.",
    warning: "Permanently deletes all document version snapshots.",
    countLabel: (c) => `${c.versions ?? 0} versions`,
  },
  {
    id: "digest",
    label: "Digest & activity feed",
    description: "Sync and indexing events shown on the Digest and Data sources pages.",
    warning: "Permanently deletes the sync activity log.",
    countLabel: (c) => `${c.digest ?? 0} events`,
  },
  {
    id: "askHistory",
    label: "Ask history",
    description: "Logged questions and answers from the console, widget, KB site and Messenger.",
    warning: "Permanently deletes all logged questions and answers.",
    countLabel: (c) => `${c.askHistory ?? 0} questions`,
  },
  {
    id: "imports",
    label: "Import history",
    description: "Finished, cancelled and failed import jobs. Running or paused imports are kept.",
    warning: "Permanently deletes the import job history.",
    countLabel: (c) => `${c.imports ?? 0} jobs`,
  },
  {
    id: "aiUsage",
    label: "AI usage",
    description: "Token usage records per provider and model.",
    warning: "Permanently deletes all AI usage records.",
    countLabel: (c) => `${c.aiUsage ?? 0} records`,
  },
  {
    id: "audit",
    label: "Audit log",
    description: "Who did what and when. One entry recording this deletion is kept.",
    warning: "Permanently deletes the audit trail.",
    countLabel: (c) => `${c.audit ?? 0} entries`,
  },
  {
    id: "sources",
    label: "Data sources",
    description: "Every connected source and everything imported from it — documents, versions, proposals and import jobs.",
    warning:
      "Permanently disconnects all sources and deletes all their documents, versions, proposals, import jobs and indexed chunks.",
    countLabel: (c) => `${c.sources ?? 0} sources`,
  },
  {
    id: "everything",
    label: "Everything",
    description:
      "Reset the knowledge base: sources, documents, review queue, projects, history, logs and usage. Settings and share configuration are kept.",
    warning:
      "Permanently deletes ALL knowledge base data and empties the Weaviate index. This cannot be undone.",
    countLabel: () => "all data",
  },
];

function DataManagement() {
  const [counts, setCounts] = useState<DataCounts | null>(null);
  const [pending, setPending] = useState<DataTarget | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/data")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setCounts(d.counts));
  }, []);

  async function confirm() {
    if (!pending) return;
    setLoading(true);
    setError(null);
    const res = await fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: pending.id }),
    });
    const d = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setError(d.error ?? "Delete failed");
      return;
    }
    setCounts(d.counts ?? counts);
    setDone(`${pending.label}: deleted ${d.deleted ?? 0} record${d.deleted === 1 ? "" : "s"}`);
    setTimeout(() => setDone(null), 4000);
    setPending(null);
  }

  return (
    <>
      <div className="mt-5 font-mono text-[10px] tracking-[0.08em] text-muted">
        DATA — DANGER ZONE
      </div>
      {done && (
        <div className="mt-2 rounded-lg border border-line bg-green-soft px-3 py-2 text-[11.5px] text-green">
          {done}
        </div>
      )}
      <div className="mt-2 overflow-hidden rounded-xl border border-warn-line bg-card">
        {DATA_TARGETS.map((t, i) => {
          const isAll = t.id === "everything";
          return (
            <div
              key={t.id}
              className={`flex items-center gap-3.5 px-[18px] py-[13px] ${
                i < DATA_TARGETS.length - 1 ? "border-b border-hairline-2" : ""
              } ${isAll ? "bg-warn-bg" : ""}`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold">{t.label}</span>
                  <span className="rounded-[5px] bg-chip px-1.5 py-0.5 font-mono text-[9.5px] text-muted">
                    {counts ? t.countLabel(counts) : "…"}
                  </span>
                </div>
                <div className="mt-0.5 text-[11.5px] leading-[1.45] text-muted">{t.description}</div>
              </div>
              <button
                onClick={() => {
                  setError(null);
                  setPending(t);
                }}
                className={`ml-auto flex-none rounded-md border px-[11px] py-[5px] text-[11.5px] font-semibold ${
                  isAll
                    ? "border-diff-del-line bg-diff-del-line text-white hover:bg-[#a85647]"
                    : "border-warn-line text-warn-text hover:border-diff-del-line hover:bg-diff-del"
                }`}
              >
                {isAll ? "Delete all" : "Delete"}
              </button>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-faint">
        Deletions are permanent and recorded in the audit log.
      </p>

      <DeleteConfirmDialog
        open={pending !== null}
        title={pending ? `Delete ${pending.label.toLowerCase()}?` : ""}
        description={pending?.description ?? ""}
        warning={pending?.warning}
        confirmLabel="Delete permanently"
        requireText={pending?.id === "everything" || pending?.id === "sources" || pending?.id === "documents" ? "DELETE" : undefined}
        loading={loading}
        error={error}
        onCancel={() => setPending(null)}
        onConfirm={confirm}
      />
    </>
  );
}
