"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TopStrip } from "@/components/Shell";
import { Icon } from "@/components/Icons";
import { Skeleton } from "@/components/Skeleton";

type ProfileData = {
  user: {
    email: string | null;
    name: string;
    createdAt: string;
    lastSignInAt: string | null;
  } | null;
  usage: {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    byProvider: {
      provider: string;
      label: string;
      model: string;
      requests: number;
      inputTokens: number;
      outputTokens: number;
    }[];
    byOperation: {
      operation: string;
      requests: number;
      inputTokens: number;
      outputTokens: number;
    }[];
    days: { date: string; tokens: number }[];
  };
  activeProvider: string;
  vector: { chunks: number; collection: string; embeddings: string } | null;
  documents: { count: number; chunks: number };
};

const OPERATION_LABELS: Record<string, string> = {
  ask: "Console questions",
  "embed-ask": "Widget & KB site",
  "assistant-draft": "Document drafts",
  "inline-edit": "Inline AI edits",
  messenger: "Messenger bot",
};

const fmt = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n);

export default function ProfilePage() {
  const [data, setData] = useState<ProfileData | null>(null);
  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: ProfileData | null) => {
        if (!d) return;
        setData(d);
        setName(d.user?.name ?? "");
      });
  }, []);

  async function patch(body: { name?: string; password?: string }) {
    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error ?? "Update failed");
    return d;
  }

  async function saveName() {
    setSavingName(true);
    setFlash(null);
    try {
      await patch({ name });
      setData((p) => (p && p.user ? { ...p, user: { ...p.user, name } } : p));
      setFlash({ kind: "ok", text: "Profile updated ✓" });
    } catch (err) {
      setFlash({ kind: "err", text: err instanceof Error ? err.message : "Update failed" });
    } finally {
      setSavingName(false);
    }
  }

  async function savePassword() {
    if (password !== confirm) {
      setFlash({ kind: "err", text: "Passwords don't match" });
      return;
    }
    setSavingPassword(true);
    setFlash(null);
    try {
      await patch({ password });
      setPassword("");
      setConfirm("");
      setFlash({ kind: "ok", text: "Password updated ✓" });
    } catch (err) {
      setFlash({ kind: "err", text: err instanceof Error ? err.message : "Update failed" });
    } finally {
      setSavingPassword(false);
    }
  }

  const maxDay = data ? Math.max(1, ...data.usage.days.map((d) => d.tokens)) : 1;
  const totalTokens = data ? data.usage.inputTokens + data.usage.outputTokens : 0;

  return (
    <>
      <TopStrip
        crumb="Nonaki / Profile"
        right={data ? <span>{fmt(totalTokens)} AI TOKENS USED</span> : undefined}
      />
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin p-7">
        <div className="max-w-[720px]">
          <h1 className="text-[21px] font-semibold tracking-[-0.01em]">Profile</h1>
          <p className="mt-0.5 text-[12.5px] text-muted">
            Your account, AI token consumption and vector database usage.
          </p>

          {flash && (
            <div
              className={`mt-3 rounded-lg border px-3 py-2 text-[11.5px] ${
                flash.kind === "ok"
                  ? "border-green-soft bg-green-soft text-green-deep"
                  : "border-warn-line bg-warn-bg text-warn-text"
              }`}
            >
              {flash.text}
            </div>
          )}

          {/* ── account ─────────────────────────────────────── */}
          <div className="mt-5 font-mono text-[10px] tracking-[0.08em] text-muted">ACCOUNT</div>
          <div className="mt-2 overflow-hidden rounded-xl border border-line bg-card">
            {!data ? (
              <div className="p-[18px]">
                <Skeleton className="h-12 w-full rounded-lg" />
              </div>
            ) : !data.user ? (
              <div className="flex items-center gap-3 px-[18px] py-[15px] text-[12.5px] text-muted">
                <Icon name="user" />
                Not signed in — authentication isn&apos;t configured for this workspace.
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3.5 border-b border-hairline-2 px-[18px] py-[15px]">
                  <span className="grid h-11 w-11 flex-none place-items-center rounded-full bg-avatar-green text-[14px] font-bold uppercase text-green-deep">
                    {(data.user.name || data.user.email || "??").slice(0, 2)}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-semibold">
                      {data.user.name || data.user.email?.split("@")[0]}
                    </div>
                    <div className="truncate text-[11.5px] text-muted">{data.user.email}</div>
                  </div>
                  <div className="ml-auto text-right text-[10.5px] leading-[1.6] text-faint">
                    <div>
                      Member since{" "}
                      {new Date(data.user.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        year: "numeric",
                      })}
                    </div>
                    {data.user.lastSignInAt && (
                      <div>
                        Last sign-in{" "}
                        {new Date(data.user.lastSignInAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-end gap-2.5 border-b border-hairline-2 px-[18px] py-[15px]">
                  <label className="min-w-0 flex-1">
                    <span className="text-[11px] font-semibold text-slate">Display name</span>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Your name"
                      className="mt-1 w-full rounded-[7px] border border-line bg-card px-3 py-2 text-[12.5px] outline-none focus:border-teal"
                    />
                  </label>
                  <label className="min-w-0 flex-1">
                    <span className="text-[11px] font-semibold text-slate">Email</span>
                    <input
                      value={data.user.email ?? ""}
                      readOnly
                      disabled
                      className="mt-1 w-full rounded-[7px] border border-line bg-chip px-3 py-2 text-[12.5px] text-muted outline-none"
                    />
                  </label>
                  <button
                    onClick={saveName}
                    disabled={savingName || name === data.user.name}
                    className="flex flex-none items-center gap-1.5 rounded-md bg-teal px-3.5 py-2 text-[11.5px] font-semibold text-white hover:bg-teal-dark disabled:opacity-50"
                  >
                    <Icon name="check" size={13} />
                    {savingName ? "Saving…" : "Save"}
                  </button>
                </div>
                <div className="flex items-end gap-2.5 px-[18px] py-[15px]">
                  <label className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate">
                      <Icon name="key" size={11} /> New password
                    </span>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Min 8 characters"
                      className="mt-1 w-full rounded-[7px] border border-line bg-card px-3 py-2 text-[12.5px] outline-none focus:border-teal"
                    />
                  </label>
                  <label className="min-w-0 flex-1">
                    <span className="text-[11px] font-semibold text-slate">Confirm password</span>
                    <input
                      type="password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      placeholder="Repeat it"
                      className="mt-1 w-full rounded-[7px] border border-line bg-card px-3 py-2 text-[12.5px] outline-none focus:border-teal"
                    />
                  </label>
                  <button
                    onClick={savePassword}
                    disabled={savingPassword || password.length < 8}
                    className="flex-none rounded-md border border-teal-line bg-card px-3.5 py-2 text-[11.5px] font-semibold text-teal hover:bg-teal-soft disabled:opacity-50"
                  >
                    {savingPassword ? "Updating…" : "Update password"}
                  </button>
                </div>
              </>
            )}
          </div>

          {/* ── AI usage ────────────────────────────────────── */}
          <div className="mt-6 flex items-center gap-2 font-mono text-[10px] tracking-[0.08em] text-muted">
            AI API USAGE
            {data && (
              <Link href="/settings" className="ml-auto flex items-center gap-1 text-teal hover:text-teal-dark">
                <Icon name="cpu" size={11} />
                ACTIVE: {data.activeProvider.toUpperCase()}
              </Link>
            )}
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2.5">
            {(
              [
                { label: "AI requests", value: data ? fmt(data.usage.requests) : null, icon: "ask" },
                { label: "Input tokens", value: data ? fmt(data.usage.inputTokens) : null, icon: "chart" },
                { label: "Output tokens", value: data ? fmt(data.usage.outputTokens) : null, icon: "chart" },
              ] as const
            ).map((tile) => (
              <div key={tile.label} className="rounded-xl border border-line bg-card px-4 py-3">
                <div className="flex items-center gap-1.5 text-[10.5px] text-muted">
                  <Icon name={tile.icon} size={11} />
                  {tile.label}
                </div>
                {tile.value === null ? (
                  <Skeleton className="mt-1.5 h-6 w-16 rounded" />
                ) : (
                  <div className="mt-1 text-[20px] font-bold tracking-[-0.01em]">{tile.value}</div>
                )}
              </div>
            ))}
          </div>

          {data && (
            <>
              {/* 14-day mini chart */}
              <div className="mt-2.5 rounded-xl border border-line bg-card px-4 py-3">
                <div className="text-[10.5px] text-muted">Tokens per day — last 14 days</div>
                <div className="mt-2 flex h-[64px] items-end gap-[3px]">
                  {data.usage.days.map((d) => (
                    <div
                      key={d.date}
                      title={`${d.date}: ${d.tokens.toLocaleString()} tokens`}
                      className="group relative flex-1 rounded-t-[3px] bg-teal-soft hover:bg-teal-line"
                      style={{ height: `${Math.max(3, (d.tokens / maxDay) * 100)}%` }}
                    >
                      {d.tokens > 0 && (
                        <div className="absolute inset-x-0 bottom-0 top-auto h-full rounded-t-[3px] bg-teal opacity-80" />
                      )}
                    </div>
                  ))}
                </div>
                <div className="mt-1 flex justify-between font-mono text-[8.5px] text-faint">
                  <span>{data.usage.days[0]?.date.slice(5)}</span>
                  <span>today</span>
                </div>
              </div>

              {/* provider breakdown */}
              <div className="mt-2.5 overflow-hidden rounded-xl border border-line bg-card">
                <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-5 border-b border-hairline-2 bg-panel px-[18px] py-2 font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
                  <span>Provider · model</span>
                  <span className="text-right">Requests</span>
                  <span className="text-right">Input</span>
                  <span className="text-right">Output</span>
                </div>
                {data.usage.byProvider.length === 0 ? (
                  <div className="px-[18px] py-4 text-[11.5px] text-muted">
                    No AI calls recorded yet — ask a question or draft a document and usage will
                    show up here.
                  </div>
                ) : (
                  data.usage.byProvider.map((r) => (
                    <div
                      key={`${r.provider}-${r.model}`}
                      className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-5 border-b border-row-line px-[18px] py-2.5 text-[12px] last:border-0"
                    >
                      <span className="min-w-0">
                        <span className="font-semibold">{r.label}</span>
                        <span className="ml-2 truncate font-mono text-[10.5px] text-muted">{r.model}</span>
                      </span>
                      <span className="text-right font-mono text-[11px]">{fmt(r.requests)}</span>
                      <span className="text-right font-mono text-[11px]">{fmt(r.inputTokens)}</span>
                      <span className="text-right font-mono text-[11px]">{fmt(r.outputTokens)}</span>
                    </div>
                  ))
                )}
              </div>

              {/* operation breakdown */}
              {data.usage.byOperation.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {data.usage.byOperation.map((op) => (
                    <span
                      key={op.operation}
                      className="rounded-lg border border-edge bg-card px-2.5 py-1.5 text-[11px] text-slate"
                    >
                      <span className="font-semibold">
                        {OPERATION_LABELS[op.operation] ?? op.operation}
                      </span>{" "}
                      · {fmt(op.inputTokens + op.outputTokens)} tokens
                    </span>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── vector database ─────────────────────────────── */}
          <div className="mt-6 font-mono text-[10px] tracking-[0.08em] text-muted">
            VECTOR DATABASE
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2.5">
            <div className="rounded-xl border border-line bg-card px-4 py-3">
              <div className="flex items-center gap-1.5 text-[10.5px] text-muted">
                <Icon name="sources" size={11} />
                Vectors stored
              </div>
              {!data ? (
                <Skeleton className="mt-1.5 h-6 w-16 rounded" />
              ) : (
                <div className="mt-1 text-[20px] font-bold tracking-[-0.01em]">
                  {data.vector ? fmt(data.vector.chunks) : "—"}
                </div>
              )}
              <div className="mt-0.5 text-[10px] text-faint">
                {data?.vector ? `“${data.vector.collection}” collection` : "Weaviate unreachable"}
              </div>
            </div>
            <div className="rounded-xl border border-line bg-card px-4 py-3">
              <div className="flex items-center gap-1.5 text-[10.5px] text-muted">
                <Icon name="docs" size={11} />
                Documents indexed
              </div>
              {!data ? (
                <Skeleton className="mt-1.5 h-6 w-16 rounded" />
              ) : (
                <div className="mt-1 text-[20px] font-bold tracking-[-0.01em]">
                  {fmt(data.documents.count)}
                </div>
              )}
              <div className="mt-0.5 text-[10px] text-faint">
                {data ? `${fmt(data.documents.chunks)} chunks tracked in Postgres` : ""}
              </div>
            </div>
            <div className="rounded-xl border border-line bg-card px-4 py-3">
              <div className="flex items-center gap-1.5 text-[10.5px] text-muted">
                <Icon name="cpu" size={11} />
                Embeddings
              </div>
              <div className="mt-1 text-[12px] font-semibold leading-[1.5]">
                {data?.vector ? data.vector.embeddings : "text2vec-weaviate"}
              </div>
              <div className="mt-0.5 text-[10px] text-faint">Built into Weaviate Cloud</div>
            </div>
          </div>
          <p className="mt-2 pb-8 text-[11px] leading-relaxed text-faint">
            Token counts are reported by each provider per request
            {data?.usage.requests ? "" : " (nothing metered yet)"} — a few older or streamed
            calls may be estimated. Vector counts come live from Weaviate.
          </p>
        </div>
      </div>
    </>
  );
}
