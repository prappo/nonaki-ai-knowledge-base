"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { ImportBar } from "./ImportBar";
import { Icon } from "./Icons";
import { createClient } from "@/lib/supabase/client";

type Stats = { docs: number; chunks: number; pending: number; sources: number };

const StatsContext = createContext<{ stats: Stats; refresh: () => void }>({
  stats: { docs: 0, chunks: 0, pending: 0, sources: 0 },
  refresh: () => {},
});

export const useStats = () => useContext(StatsContext);

const NAV = [
  { href: "/", label: "Ask", icon: "ask" },
  { href: "/docs", label: "Documents", icon: "docs" },
  { href: "/review", label: "Review queue", icon: "review" },
  { href: "/digest", label: "Digest", icon: "digest" },
  { href: "/sources", label: "Data sources", icon: "sources" },
  { href: "/imports", label: "Imports", icon: "imports" },
  { href: "/audit", label: "Audit log", icon: "audit" },
] as const;

const SHARE_ITEMS = [
  { href: "/share/widget", label: "Chat widget", icon: "bubble" },
  { href: "/share/chatbot", label: "Chatbot", icon: "bot" },
  { href: "/share/mcp", label: "MCP server", icon: "plug" },
  { href: "/share/kb", label: "Knowledge base", icon: "book" },
] as const;

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [stats, setStats] = useState<Stats>({ docs: 0, chunks: 0, pending: 0, sources: 0 });
  const [collapsed, setCollapsed] = useState(false);
  const [dark, setDark] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setUserEmail(data.user?.email ?? null));
  }, [pathname]);

  async function signOut() {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  // restore preferences (client-only to stay hydration-safe; theme class is
  // already applied pre-paint by the inline script in layout.tsx)
  useEffect(() => {
    setCollapsed(localStorage.getItem("nonaki-sidebar") === "collapsed");
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      localStorage.setItem("nonaki-sidebar", v ? "expanded" : "collapsed");
      return !v;
    });
  };

  const toggleTheme = () => {
    setDark((v) => {
      const next = !v;
      document.documentElement.classList.toggle("dark", next);
      localStorage.setItem("nonaki-theme", next ? "dark" : "light");
      return next;
    });
  };

  const refresh = useCallback(() => {
    fetch("/api/stats")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        // ignore 401s (no session yet) and malformed payloads
        if (d && typeof d.docs === "number") setStats(d);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 20_000);
    return () => clearInterval(t);
  }, [refresh, pathname]);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const inShare = pathname.startsWith("/share");
  const [shareOpen, setShareOpen] = useState(false);
  useEffect(() => {
    if (inShare) setShareOpen(true);
  }, [inShare]);

  const itemClass = (active: boolean) =>
    `group relative flex items-center rounded-lg py-2 text-[12.5px] transition-colors ${
      collapsed ? "justify-center px-0" : "gap-2.5 px-3"
    } ${
      active
        ? "bg-card font-semibold text-teal-dark shadow-[0_1px_3px_rgba(20,40,45,0.08)]"
        : "text-slate hover:bg-railhover hover:text-ink"
    }`;

  // Public pages (embed iframes, KB site, login) render without the shell
  if (pathname.startsWith("/embed") || pathname === "/login") {
    return <>{children}</>;
  }

  return (
    <StatsContext.Provider value={{ stats, refresh }}>
      <div className="flex h-screen text-[13px] text-ink">
        {/* sidebar */}
        <aside
          className={`flex flex-none flex-col border-r border-line bg-rail transition-[width] duration-200 ${
            collapsed ? "w-[62px]" : "w-[196px]"
          }`}
        >
          {/* brand + collapse toggle */}
          <div
            className={`flex items-center pt-4 pb-4 ${
              collapsed ? "flex-col gap-2 px-0" : "gap-2.5 px-4"
            }`}
          >
            <Link href="/" className="flex-none">
              <Image
                src="/logo.png?v=2"
                alt="Nonaki"
                width={30}
                height={34}
                className="h-[30px] w-auto"
                priority
              />
            </Link>
            {!collapsed && (
              <Link href="/" className="leading-tight">
                <span className="block text-[13.5px] font-bold tracking-[-0.01em]">
                  Nonaki
                </span>
                <span className="block font-mono text-[8.5px] tracking-[0.12em] text-muted">
                  KNOWLEDGE BASE
                </span>
              </Link>
            )}
            <button
              onClick={toggleCollapsed}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className={`grid h-6 w-6 place-items-center rounded-md text-muted transition-colors hover:bg-railhover hover:text-ink ${
                collapsed ? "" : "ml-auto"
              }`}
            >
              <Icon name={collapsed ? "expand" : "collapse"} size={14} />
            </button>
          </div>

          {/* nav */}
          <nav className={`flex flex-col gap-0.5 ${collapsed ? "px-2" : "px-2.5"}`}>
            {NAV.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={collapsed ? item.label : undefined}
                  className={itemClass(active)}
                >
                  <span className={active ? "text-teal" : "text-muted group-hover:text-slate"}>
                    <Icon name={item.icon} />
                  </span>
                  {!collapsed && item.label}
                  {item.icon === "review" && stats.pending > 0 && (
                    <span
                      className={`rounded-full font-mono font-bold text-white ${
                        collapsed
                          ? "absolute -right-0.5 -top-0.5 px-[5px] py-px text-[8px]"
                          : "ml-auto px-[7px] py-px text-[9px]"
                      } ${active && !collapsed ? "bg-teal" : "bg-orange"}`}
                    >
                      {stats.pending}
                    </span>
                  )}
                </Link>
              );
            })}

            {/* Share group */}
            {collapsed ? (
              <Link href="/share/widget" title="Share" className={itemClass(inShare)}>
                <span className={inShare ? "text-teal" : "text-muted group-hover:text-slate"}>
                  <Icon name="share" />
                </span>
              </Link>
            ) : (
              <>
                <button
                  onClick={() => setShareOpen((v) => !v)}
                  className={`${itemClass(inShare && !shareOpen)} w-full text-left`}
                >
                  <span className={inShare ? "text-teal" : "text-muted group-hover:text-slate"}>
                    <Icon name="share" />
                  </span>
                  Share
                  <span
                    className={`ml-auto text-faint transition-transform ${
                      shareOpen ? "" : "-rotate-90"
                    }`}
                  >
                    <Icon name="chevron-down" size={12} />
                  </span>
                </button>
                {shareOpen &&
                  SHARE_ITEMS.map((item) => {
                    const active = isActive(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`group ml-[18px] flex items-center gap-2 rounded-lg border-l border-line py-1.5 pl-3.5 pr-2 text-[12px] transition-colors ${
                          active
                            ? "bg-white font-semibold text-teal-dark shadow-[0_1px_3px_rgba(20,40,45,0.08)]"
                            : "text-slate hover:bg-railhover hover:text-ink"
                        }`}
                      >
                        <span className={active ? "text-teal" : "text-muted group-hover:text-slate"}>
                          <Icon name={item.icon} size={14} />
                        </span>
                        {item.label}
                      </Link>
                    );
                  })}
              </>
            )}
          </nav>

          {/* index summary (expanded only) */}
          {!collapsed && (
            <div className="mx-2.5 mt-5 rounded-lg border border-line bg-card px-3 py-2.5">
              <div className="font-mono text-[8.5px] tracking-[0.1em] text-muted">INDEX</div>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="text-[16px] font-bold tracking-[-0.01em]">
                  {stats.docs.toLocaleString()}
                </span>
                <span className="text-[10px] text-muted">docs</span>
                <span className="ml-auto text-[10px] text-faint">
                  {stats.chunks.toLocaleString()} chunks
                </span>
              </div>
              <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-muted">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    stats.pending > 0 ? "bg-orange" : "bg-green"
                  }`}
                />
                {stats.pending > 0
                  ? `${stats.pending} awaiting review`
                  : "Everything reviewed"}
              </div>
            </div>
          )}

          {/* bottom */}
          <div className={`mt-auto flex flex-col gap-0.5 pb-3 ${collapsed ? "px-2" : "px-2.5"}`}>
            <button
              onClick={toggleTheme}
              title={collapsed ? (dark ? "Light mode" : "Dark mode") : undefined}
              className={`${itemClass(false)} w-full text-left`}
            >
              <span className="text-muted group-hover:text-slate">
                <Icon name={dark ? "sun" : "moon"} />
              </span>
              {!collapsed && (dark ? "Light mode" : "Dark mode")}
            </button>
            <Link
              href="/profile"
              title={collapsed ? "Profile" : undefined}
              className={itemClass(isActive("/profile"))}
            >
              <span
                className={
                  isActive("/profile") ? "text-teal" : "text-muted group-hover:text-slate"
                }
              >
                <Icon name="user" />
              </span>
              {!collapsed && "Profile"}
            </Link>
            <Link
              href="/settings"
              title={collapsed ? "Settings" : undefined}
              className={itemClass(isActive("/settings"))}
            >
              <span
                className={
                  isActive("/settings") ? "text-teal" : "text-muted group-hover:text-slate"
                }
              >
                <Icon name="settings" />
              </span>
              {!collapsed && "Settings"}
            </Link>
            <div className="mx-1 my-1.5 border-t border-line" />
            <div
              className={`flex items-center py-1.5 ${
                collapsed ? "justify-center px-0" : "gap-2.5 px-3"
              }`}
              title={collapsed ? (userEmail ?? "Workspace") : undefined}
            >
              <Link
                href="/profile"
                className="grid h-6 w-6 flex-none place-items-center rounded-full bg-avatar-green text-[9px] font-semibold uppercase text-green-deep"
              >
                {(userEmail ?? "??").slice(0, 2)}
              </Link>
              {!collapsed && (
                <>
                  <Link href="/profile" className="min-w-0 leading-tight">
                    <span className="block truncate text-[11.5px] font-semibold">
                      {userEmail ? userEmail.split("@")[0] : "Workspace"}
                    </span>
                    <span className="block truncate text-[9.5px] text-faint">
                      {userEmail ?? "Local"}
                    </span>
                  </Link>
                  {userEmail && (
                    <button
                      onClick={signOut}
                      title="Sign out"
                      className="ml-auto grid h-6 w-6 flex-none place-items-center rounded-md text-muted hover:bg-railhover hover:text-orange"
                    >
                      <Icon name="logout" size={13} />
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </aside>

        {/* main */}
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>

        {/* background import progress — visible on every page */}
        <ImportBar onJobsChange={refresh} />
      </div>
    </StatsContext.Provider>
  );
}

/** Mono top strip shared by all screens — also sets the browser tab title. */
export function TopStrip({
  crumb,
  right,
}: {
  crumb: string;
  right?: React.ReactNode;
}) {
  const { stats } = useStats();

  useEffect(() => {
    // "Nonaki / Share / Chat Widget" → "Chat Widget · Nonaki"
    const parts = crumb.split("/").map((p) => p.trim()).filter(Boolean);
    const page = parts[parts.length - 1] || "Nonaki";
    document.title = page === "Nonaki" ? "Nonaki — AI Knowledge Base" : `${page} · Nonaki`;
  }, [crumb]);
  return (
    <div className="flex flex-none items-center gap-4 border-b border-hairline px-6 py-2.5 font-mono text-[10.5px] tracking-[0.03em] text-muted">
      <span className="uppercase">{crumb}</span>
      <span className="ml-auto flex items-center gap-1.5">
        <span className="inline-block h-[7px] w-[7px] rounded-full bg-green" />
        {stats.docs.toLocaleString()} DOCS · {stats.chunks.toLocaleString()} CHUNKS INDEXED
      </span>
      {right ?? (
        <span className={stats.pending > 0 ? "text-amber" : ""}>
          {stats.pending > 0 ? `${stats.pending} PROPOSALS WAITING` : "QUEUE CLEAR"}
        </span>
      )}
    </div>
  );
}
