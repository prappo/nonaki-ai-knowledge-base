"use client";

import { useEffect, useState } from "react";
import { TopStrip } from "@/components/Shell";
import { SourcePicker } from "@/components/SourcePicker";
import { SharePageSkeleton } from "@/components/Skeleton";

type ProjectAccess = "off" | "read" | "write";

type McpConfig = {
  enabled: boolean;
  apiKey: string;
  sourceIds: string[];
  projectAccess: ProjectAccess;
};

const PROJECT_READ_TOOLS = [
  { name: "list_projects", desc: "projects with status and task progress" },
  { name: "get_project", desc: "one project's task board and linked docs" },
] as const;

const PROJECT_WRITE_TOOLS = [
  { name: "create_project", desc: "new project, optionally with a task breakdown" },
  { name: "update_project", desc: "rename, re-describe, change status or due date" },
  { name: "add_tasks", desc: "add tasks to a project" },
  { name: "update_task", desc: "edit a task or move it todo → doing → done" },
  { name: "delete_task", desc: "remove a task" },
  { name: "link_documents / unlink_document", desc: "attach knowledge-base docs to a project" },
] as const;

const PROJECT_ACCESS: { value: ProjectAccess; label: string; desc: string }[] = [
  { value: "off", label: "Off", desc: "No project tools" },
  { value: "read", label: "Read only", desc: "View projects and boards" },
  { value: "write", label: "Read & write", desc: "Agents can plan: create projects, add and move tasks" },
];

const TOOLS = [
  {
    name: "search_knowledge_base",
    desc: "hybrid search — returns the best-matching passages with scores",
  },
  {
    name: "ask_knowledge_base",
    desc: "AI answer grounded in your docs, with [n] citations",
  },
  {
    name: "read_document",
    desc: "full content of one document by id",
  },
] as const;

export default function ShareMcpPage() {
  const [config, setConfig] = useState<McpConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [keyVisible, setKeyVisible] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
    fetch("/api/share/mcp")
      .then((r) => r.json())
      .then((d) => setConfig(d.config));
  }, []);

  const patch = (p: Partial<McpConfig>) => setConfig((c) => (c ? { ...c, ...p } : c));

  async function save(overrides: Partial<McpConfig> = {}) {
    if (!config) return;
    setSaving(true);
    await fetch("/api/share/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...config, ...overrides }),
    });
    // re-read so a freshly minted key comes back
    const d = await fetch("/api/share/mcp").then((r) => r.json());
    setConfig(d.config);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  // saving an empty key makes the server mint a new one
  const regenerate = () => save({ apiKey: "" });

  function copy(text: string, which: string) {
    navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 1500);
  }

  if (!config) {
    return (
      <>
        <TopStrip crumb="Nonaki / Share / MCP Server" />
        <SharePageSkeleton />
      </>
    );
  }

  const endpoint = `${origin}/api/mcp`;
  const maskedKey = `${config.apiKey.slice(0, 11)}…${config.apiKey.slice(-4)}`;
  const claudeCodeCmd = `claude mcp add --transport http nonaki ${endpoint} --header "Authorization: Bearer ${config.apiKey}"`;
  const jsonConfig = JSON.stringify(
    {
      mcpServers: {
        nonaki: {
          type: "http",
          url: endpoint,
          headers: { Authorization: `Bearer ${config.apiKey}` },
        },
      },
    },
    null,
    2
  );

  return (
    <>
      <TopStrip
        crumb="Nonaki / Share / MCP Server"
        right={
          <span className={config.enabled ? "text-green" : ""}>
            {config.enabled ? "MCP ENABLED" : "MCP DISABLED"}
          </span>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin p-7">
        <div className="max-w-[720px]">
          <div className="flex items-baseline gap-2.5">
            <h1 className="text-[21px] font-semibold tracking-[-0.01em]">MCP server</h1>
            <span className="text-xs text-muted">
              let AI assistants (Claude, Cursor, …) search and cite your knowledge base
            </span>
          </div>

          {/* enable + connection */}
          <div className="mt-4 space-y-4 rounded-xl border border-line bg-card p-4">
            <div className="flex items-center gap-3">
              <div className="font-mono text-[10px] tracking-[0.08em] text-muted">
                SERVER CONNECTION
              </div>
              <label className="ml-auto flex cursor-pointer items-center gap-2">
                <span className="text-xs font-semibold">
                  {config.enabled ? "Enabled" : "Disabled"}
                </span>
                <button
                  onClick={() => patch({ enabled: !config.enabled })}
                  className={`relative h-[19px] w-[34px] rounded-[10px] transition-colors ${
                    config.enabled ? "bg-teal" : "bg-edge"
                  }`}
                >
                  <span
                    className={`absolute top-[2.5px] h-3.5 w-3.5 rounded-full bg-white transition-all ${
                      config.enabled ? "right-[2.5px]" : "left-[2.5px]"
                    }`}
                  />
                </button>
              </label>
            </div>

            <div>
              <span className="text-xs font-semibold">Endpoint URL</span>
              <span className="ml-1 text-[10.5px] text-muted">
                (Streamable HTTP transport)
              </span>
              <div className="mt-1 flex gap-1.5">
                <code className="min-w-0 flex-1 truncate rounded-[7px] border border-line bg-chip px-3 py-2 font-mono text-[11px] text-slate">
                  {endpoint}
                </code>
                <button
                  onClick={() => copy(endpoint, "url")}
                  className="flex-none rounded-[7px] border border-teal-line px-3 py-2 text-[11px] font-semibold text-teal hover:bg-teal-soft"
                >
                  {copied === "url" ? "Copied ✓" : "Copy"}
                </button>
              </div>
            </div>

            <div>
              <span className="text-xs font-semibold">API key</span>
              <span className="ml-1 text-[10.5px] text-muted">
                (sent as <span className="font-mono">Authorization: Bearer …</span>)
              </span>
              <div className="mt-1 flex gap-1.5">
                <code className="min-w-0 flex-1 truncate rounded-[7px] border border-line bg-chip px-3 py-2 font-mono text-[11px] text-slate">
                  {keyVisible ? config.apiKey : maskedKey}
                </code>
                <button
                  onClick={() => setKeyVisible((v) => !v)}
                  className="flex-none rounded-[7px] border border-edge px-3 py-2 text-[11px] font-semibold text-muted hover:border-teal hover:text-teal"
                >
                  {keyVisible ? "Hide" : "Show"}
                </button>
                <button
                  onClick={() => copy(config.apiKey, "key")}
                  className="flex-none rounded-[7px] border border-teal-line px-3 py-2 text-[11px] font-semibold text-teal hover:bg-teal-soft"
                >
                  {copied === "key" ? "Copied ✓" : "Copy"}
                </button>
                <button
                  onClick={regenerate}
                  disabled={saving}
                  className="flex-none rounded-[7px] border border-edge px-3 py-2 text-[11px] font-semibold text-muted hover:border-orange hover:text-orange disabled:opacity-60"
                >
                  Regenerate
                </button>
              </div>
              <div className="mt-1 text-[10.5px] text-faint">
                Regenerating invalidates the old key immediately — every connected client
                must be updated.
              </div>
            </div>
          </div>

          {/* scope + tools */}
          <div className="mt-4 space-y-4 rounded-xl border border-line bg-card p-4">
            <div className="font-mono text-[10px] tracking-[0.08em] text-muted">
              EXPOSED KNOWLEDGE
            </div>
            <SourcePicker
              value={config.sourceIds}
              onChange={(sourceIds) => patch({ sourceIds })}
              label="Answers from these sources"
            />
            <div>
              <span className="text-xs font-semibold">Project planning access</span>
              <div className="mt-1.5 grid grid-cols-3 gap-2">
                {PROJECT_ACCESS.map((a) => {
                  const active = (config.projectAccess ?? "write") === a.value;
                  return (
                    <button
                      key={a.value}
                      onClick={() => patch({ projectAccess: a.value })}
                      className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                        active
                          ? "border-teal bg-teal-soft"
                          : "border-line bg-card hover:border-teal"
                      }`}
                    >
                      <div className={`text-[12px] font-semibold ${active ? "text-teal-dark" : ""}`}>
                        {a.label}
                      </div>
                      <div className="mt-0.5 text-[10.5px] leading-[1.4] text-muted">{a.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <span className="text-xs font-semibold">Tools clients get</span>
              <div className="mt-1.5 space-y-1.5">
                {[
                  ...TOOLS,
                  ...(config.projectAccess !== "off" ? PROJECT_READ_TOOLS : []),
                  ...(config.projectAccess === "write" ? PROJECT_WRITE_TOOLS : []),
                ].map((t) => (
                  <div key={t.name} className="flex items-baseline gap-2 text-[11px]">
                    <code className="rounded bg-chip px-1.5 py-0.5 font-mono text-[10.5px] text-teal-dark">
                      {t.name}
                    </code>
                    <span className="text-muted">{t.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4">
            <button
              onClick={() => save()}
              disabled={saving}
              className="rounded-[7px] bg-teal px-5 py-2 text-xs font-semibold text-white hover:bg-teal-dark disabled:opacity-60"
            >
              {saving ? "Saving…" : saved ? "Saved ✓" : "Save MCP server"}
            </button>
          </div>

          {/* connect */}
          <div className="mt-4 space-y-3 rounded-xl border border-teal-line bg-teal-mist p-4">
            <div className="font-mono text-[10px] tracking-[0.08em] text-teal">
              CONNECT A CLIENT
            </div>
            <div>
              <div className="flex items-center">
                <span className="text-xs font-semibold">Claude Code</span>
                <button
                  onClick={() => copy(claudeCodeCmd, "cc")}
                  className="ml-auto rounded-md border border-teal-line bg-card px-3 py-1 text-[11px] font-semibold text-teal hover:bg-teal-soft"
                >
                  {copied === "cc" ? "Copied ✓" : "Copy command"}
                </button>
              </div>
              <pre className="scrollbar-thin mt-1 overflow-x-auto rounded-lg bg-ink p-3 font-mono text-[10.5px] leading-relaxed text-[#7fd1de]">
                {claudeCodeCmd}
              </pre>
            </div>
            <div>
              <div className="flex items-center">
                <span className="text-xs font-semibold">
                  Claude Desktop / Cursor / other MCP clients
                </span>
                <button
                  onClick={() => copy(jsonConfig, "json")}
                  className="ml-auto rounded-md border border-teal-line bg-card px-3 py-1 text-[11px] font-semibold text-teal hover:bg-teal-soft"
                >
                  {copied === "json" ? "Copied ✓" : "Copy config"}
                </button>
              </div>
              <pre className="scrollbar-thin mt-1 overflow-x-auto rounded-lg bg-ink p-3 font-mono text-[10.5px] leading-relaxed text-[#7fd1de]">
                {jsonConfig}
              </pre>
            </div>
            <div className="text-[10.5px] text-faint">
              Note: remote clients need a public HTTPS URL — expose localhost with a tunnel
              (e.g. <span className="font-mono">ngrok http 3000</span>) or deploy first.
            </div>
          </div>

          {/* setup guide */}
          <div className="mt-5 rounded-xl border border-line bg-card p-4">
            <div className="font-mono text-[10px] tracking-[0.08em] text-muted">
              SETUP GUIDE — MODEL CONTEXT PROTOCOL
            </div>
            <ol className="mt-3 space-y-2.5 text-xs leading-relaxed text-slate">
              {[
                <>Flip the server to <b>Enabled</b> above and pick which sources it may answer from, then <b>Save</b>.</>,
                <>Copy the <b>endpoint URL</b> and <b>API key</b> — together they are the whole connection; there is nothing to install on this side.</>,
                <>Add the server to your client: paste the <b>Claude Code command</b> in a terminal, or the <b>JSON config</b> into Claude Desktop&apos;s / Cursor&apos;s MCP settings.</>,
                <>Ask your assistant something your docs answer — it will call{" "}
                  <span className="font-mono">search_knowledge_base</span> or{" "}
                  <span className="font-mono">ask_knowledge_base</span> and cite the documents it used.</>,
              ].map((step, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="grid h-5 w-5 flex-none place-items-center rounded-full bg-teal-soft font-mono text-[10px] font-bold text-teal-dark">
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
            <div className="mt-3 rounded-lg border border-warn-line bg-warn-bg px-3 py-2 text-[11px] leading-relaxed text-warn-text">
              <b>Good to know:</b> the API key grants read access to every source selected
              above{config.projectAccess === "write" ? " and lets clients edit your projects" : ""}
              {" "}— treat it like a password. Rotate it with <b>Regenerate</b> if it ever
              leaks, and scope the sources to what external assistants should really see.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
