"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ListRowsSkeleton, Skeleton, TextSkeleton } from "@/components/Skeleton";
import { TopStrip } from "@/components/Shell";

type Digest = {
  stats: {
    docsIndexed: number;
    chunksIndexed: number;
    eventsWatched: number;
    driftedThisWeek: number;
    pendingProposals: number;
    approvedThisWeek: number;
    answersThisWeek: number;
  };
  pendingList: {
    id: string;
    type: string;
    reason: string | null;
    document: { id: string; title: string; source: { name: string; type: string } };
  }[];
  recentResolved: {
    id: string;
    type: string;
    status: string;
    resolvedAt: string | null;
    document: { title: string; source: { name: string; type: string } };
  }[];
  recentLogs: { id: string; message: string; level: string; createdAt: string }[];
};

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "NOW";
  if (s < 3600) return `${Math.floor(s / 60)} MIN`;
  if (s < 86400) return `${Math.floor(s / 3600)} H`;
  return `${Math.floor(s / 86400)} D`;
}

function weekRange(): string {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - 6);
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase();
  return `WEEK OF ${fmt(start)} – ${fmt(now)}`;
}

export default function DigestPage() {
  const [digest, setDigest] = useState<Digest | null>(null);

  useEffect(() => {
    fetch("/api/digest")
      .then((r) => r.json())
      .then(setDigest)
      .catch(() => {});
  }, []);

  const s = digest?.stats;

  return (
    <>
      <TopStrip crumb="Nonaki / Digest" right={<span>{weekRange()}</span>} />
      <div className="flex min-h-0 flex-1 gap-7 overflow-y-auto scrollbar-thin p-7">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] font-semibold tracking-[-0.01em]">
            Your maintenance digest
          </h1>
          <p className="mt-0.5 text-[12.5px] text-muted">
            Nonaki keeps {s?.docsIndexed ?? "…"} docs honest across your sources.
            Here&apos;s the week.
          </p>

          {/* stat cards */}
          <div className="mt-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <StatCard value={s?.eventsWatched} label="sync & index events this week" />
            <StatCard value={s?.driftedThisWeek} label="docs drifted from their source" color="text-amber" />
            <StatCard value={s?.pendingProposals} label="updates drafted, awaiting review" color="text-teal" />
            <StatCard value={s?.approvedThisWeek} label="approved & re-indexed this week" color="text-green" />
          </div>

          {/* needs your call */}
          <div className="mt-5 font-mono text-[10px] tracking-[0.08em] text-muted">
            NEEDS YOUR CALL — {digest?.pendingList.length ?? 0} PROPOSAL
            {(digest?.pendingList.length ?? 0) === 1 ? "" : "S"}
          </div>
          <div className="mt-2 overflow-hidden rounded-xl border border-line bg-card">
            {!digest && <ListRowsSkeleton rows={3} icon={false} />}
            {digest?.pendingList.map((p, i) => (
              <div
                key={p.id}
                className={`flex items-center gap-3 px-4 py-3 ${
                  i < digest.pendingList.length - 1 ? "border-b border-hairline-2" : ""
                }`}
              >
                <span className="h-2 w-2 flex-none rounded-full bg-orange" />
                <div className="min-w-0 truncate">
                  <b className="text-[12.5px]">{p.document.title}</b>{" "}
                  <span className="text-xs text-muted">— {p.reason}</span>
                </div>
                <Link
                  href="/review"
                  className={`ml-auto flex-none rounded-md px-3 py-1 text-[11.5px] font-semibold ${
                    i === 0
                      ? "bg-teal text-white hover:bg-teal-dark"
                      : "border border-teal-line bg-card text-teal hover:bg-teal-soft"
                  }`}
                >
                  Review diff
                </Link>
              </div>
            ))}
            {digest && digest.pendingList.length === 0 && (
              <div className="px-4 py-5 text-xs text-muted">
                Nothing needs your attention — the base matches its sources. ✓
              </div>
            )}
          </div>

          {/* handled */}
          <div className="mt-5 font-mono text-[10px] tracking-[0.08em] text-muted">
            HANDLED — RECENT DECISIONS
          </div>
          <div className="mt-2 flex flex-col gap-1.5">
            {!digest &&
              Array.from({ length: 3 }, (_, i) => (
                <div
                  key={i}
                  className="rounded-[9px] border border-hairline bg-card px-3.5 py-3"
                  style={{ opacity: 1 - i * 0.2 }}
                >
                  <Skeleton className="h-3 w-3/4" />
                </div>
              ))}
            {digest?.recentResolved.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-2.5 rounded-[9px] border border-hairline bg-card px-3.5 py-2.5 text-xs text-slate"
              >
                <span className={`flex-none ${p.status === "approved" ? "text-green" : "text-faint"}`}>
                  {p.status === "approved" ? "✓" : "✕"}
                </span>
                <div className="min-w-0 truncate">
                  <b>{p.document.title}</b>{" "}
                  {p.status === "approved"
                    ? p.type === "archive"
                      ? "archived — removed from the index"
                      : "updated — re-chunked & re-indexed"
                    : "proposal rejected — current version kept"}
                </div>
                <span className="ml-auto flex-none font-mono text-[9.5px] uppercase text-faint">
                  {p.document.source.type} → {p.type}
                </span>
              </div>
            ))}
            {digest && digest.recentResolved.length === 0 && (
              <div className="rounded-[9px] border border-hairline bg-card px-3.5 py-4 text-xs text-muted">
                No decisions yet — approvals and rejections will appear here.
              </div>
            )}
          </div>
        </div>

        {/* right: activity feed */}
        <div className="flex w-[270px] flex-none flex-col gap-3.5">
          <div className="rounded-xl border border-line bg-card px-[18px] py-4">
            <div className="font-mono text-[10px] tracking-[0.08em] text-muted">
              ACTIVITY · LIVE
            </div>
            <div className="mt-3 flex flex-col gap-[11px] text-[11.5px] leading-[1.5] text-slate">
              {!digest && <TextSkeleton lines={6} />}
              {digest?.recentLogs.map((l) => (
                <div key={l.id} className="flex gap-2">
                  <span
                    className={`mt-1 h-[7px] w-[7px] flex-none rounded-full ${
                      l.level === "error"
                        ? "bg-orange"
                        : l.message.includes("proposal") || l.message.includes("drafted")
                          ? "bg-teal"
                          : "bg-faint"
                    }`}
                  />
                  <div>
                    {l.message}
                    <div className="mt-0.5 font-mono text-[9.5px] text-faint">
                      {timeAgo(l.createdAt)}
                    </div>
                  </div>
                </div>
              ))}
              {digest && digest.recentLogs.length === 0 && (
                <div className="text-faint">No activity yet.</div>
              )}
            </div>
          </div>
          <div className="rounded-xl border border-teal-line bg-teal-mist px-[18px] py-4">
            <div className="font-mono text-[10px] tracking-[0.08em] text-teal">
              ANSWERS THIS WEEK
            </div>
            <div className="mt-2 text-[11.5px] leading-[1.55] text-teal-ink">
              <b>{s?.answersThisWeek ?? 0} questions</b> answered from the base
              this week — every claim cited to an indexed chunk.
            </div>
            <Link
              href="/"
              className="mt-2.5 block text-[11.5px] font-semibold text-teal hover:text-teal-dark"
            >
              Ask something →
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}

function StatCard({
  value,
  label,
  color = "",
}: {
  value?: number;
  label: string;
  color?: string;
}) {
  return (
    <div className="rounded-[10px] border border-line bg-card px-[15px] py-3">
      {value === undefined ? (
        <Skeleton className="h-7 w-12 rounded-md" />
      ) : (
        <div className={`text-[22px] font-bold tracking-[-0.02em] ${color}`}>{value}</div>
      )}
      <div className="mt-0.5 text-[11px] leading-[1.4] text-muted">{label}</div>
    </div>
  );
}
