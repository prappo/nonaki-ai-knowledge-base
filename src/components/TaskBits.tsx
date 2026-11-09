"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icons";

export type AppUser = { email: string; name: string | null };

// ── who can be assigned ──────────────────────────────────────────────────

let usersCache: Promise<{ users: AppUser[]; me: string | null }> | null = null;

/** The app's users and the signed-in email, fetched once per page load. */
export function useUsers() {
  const [state, setState] = useState<{ users: AppUser[]; me: string | null; loaded: boolean }>({
    users: [],
    me: null,
    loaded: false,
  });

  useEffect(() => {
    usersCache ??= fetch("/api/users")
      .then((r) => (r.ok ? r.json() : { users: [], me: null }))
      .catch(() => ({ users: [], me: null }));
    let live = true;
    usersCache.then((d) => live && setState({ users: d.users ?? [], me: d.me ?? null, loaded: true }));
    return () => {
      live = false;
    };
  }, []);

  return state;
}

/** "Prappo Prince" or "prappo.prince@gmail.com" → "PP" */
export function initials(user: AppUser | string): string {
  const name = typeof user === "string" ? null : user.name;
  const email = typeof user === "string" ? user : user.email;
  const words = (name || email.split("@")[0]).split(/[\s._-]+/).filter(Boolean);
  return ((words[0]?.[0] ?? "?") + (words[1]?.[0] ?? "")).toUpperCase();
}

export function displayName(user: AppUser | null | undefined, email: string): string {
  return user?.name || email.split("@")[0];
}

const AVATAR_TONES = [
  "bg-teal-soft text-teal-dark",
  "bg-amber-soft text-amber",
  "bg-green-soft text-green-deep",
  "bg-wp-chip text-wp-ink",
  "bg-gh-chip text-gh-ink",
];

function tone(email: string): string {
  let h = 0;
  for (const c of email) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

/** Round initials badge for an assignee; a dashed ring when nobody is assigned. */
export function Avatar({
  email,
  users,
  size = 20,
}: {
  email: string | null;
  users: AppUser[];
  size?: number;
}) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42) };
  if (!email) {
    return (
      <span
        style={style}
        title="Unassigned"
        className="grid flex-none place-items-center rounded-full border border-dashed border-ghost text-faint"
      >
        <Icon name="user" size={Math.round(size * 0.55)} />
      </span>
    );
  }
  const user = users.find((u) => u.email === email);
  return (
    <span
      style={style}
      title={user?.name ? `${user.name} · ${email}` : email}
      className={`grid flex-none place-items-center rounded-full font-semibold ${tone(email)}`}
    >
      {initials(user ?? email)}
    </span>
  );
}

/**
 * Pick who a task is assigned to: searchable list of users, "Assign to me",
 * and "Unassigned". `compact` shows just the avatar as the trigger.
 */
export function AssigneePicker({
  value,
  users,
  me,
  onChange,
  compact = false,
  align = "left",
}: {
  value: string | null;
  users: AppUser[];
  me: string | null;
  onChange: (email: string | null) => void;
  compact?: boolean;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const q = query.trim().toLowerCase();
  const matches = users.filter(
    (u) => !q || u.email.includes(q) || (u.name ?? "").toLowerCase().includes(q)
  );
  const current = users.find((u) => u.email === value);

  const pick = (email: string | null) => {
    setOpen(false);
    setQuery("");
    if (email !== value) onChange(email);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        title={value ? `Assigned to ${value}` : "Assign"}
        className={
          compact
            ? "grid place-items-center rounded-full hover:ring-2 hover:ring-teal-soft"
            : "flex items-center gap-1.5 rounded-full border border-edge bg-card py-0.5 pl-0.5 pr-2.5 text-[11px] text-slate hover:border-teal"
        }
      >
        <Avatar email={value} users={users} size={compact ? 22 : 20} />
        {!compact && <span>{value ? displayName(current, value) : "Unassigned"}</span>}
      </button>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className={`absolute top-[calc(100%+6px)] z-40 w-64 overflow-hidden rounded-lg border border-line bg-card shadow-[0_8px_28px_rgba(10,20,25,0.14)] ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          <div className="border-b border-hairline-2 px-3 py-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search people…"
              className="w-full bg-transparent text-[12px] outline-none placeholder:text-faint"
            />
          </div>
          <div className="max-h-64 overflow-y-auto scrollbar-thin py-1">
            {me && me !== value && !q && (
              <PickerRow onClick={() => pick(me)} active={false}>
                <Avatar email={me} users={users} />
                <span className="font-semibold text-teal-dark">Assign to me</span>
              </PickerRow>
            )}
            {value && !q && (
              <PickerRow onClick={() => pick(null)} active={false}>
                <Avatar email={null} users={users} />
                <span className="text-muted">Unassign</span>
              </PickerRow>
            )}
            {matches.map((u) => (
              <PickerRow key={u.email} onClick={() => pick(u.email)} active={u.email === value}>
                <Avatar email={u.email} users={users} />
                <span className="min-w-0 flex-1 truncate">
                  {u.name ? (
                    <>
                      {u.name} <span className="text-faint">{u.email}</span>
                    </>
                  ) : (
                    u.email
                  )}
                  {u.email === me && <span className="text-faint"> (you)</span>}
                </span>
                {u.email === value && <Icon name="check" size={12} className="flex-none text-teal" />}
              </PickerRow>
            ))}
            {matches.length === 0 && (
              <div className="px-3 py-2 text-[11.5px] text-muted">
                {users.length === 0 ? "No users found" : "Nobody matches"}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PickerRow({
  children,
  onClick,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-hover ${
        active ? "bg-teal-wash" : ""
      }`}
    >
      {children}
    </button>
  );
}
