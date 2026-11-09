import { prisma } from "./prisma";
import { currentActor } from "./audit";

export type AppUser = { email: string; name: string | null };

/**
 * The people tasks can be assigned to: every active Supabase Auth user.
 *
 * Read straight from `auth.users`, which lives in the same Postgres as the app
 * (local Docker stack and Supabase alike). When that schema isn't reachable —
 * no Supabase, or a role without access — fall back to the emails already on
 * tasks plus the signed-in user, so assigning still works.
 */
export async function listUsers(): Promise<AppUser[]> {
  const byEmail = new Map<string, AppUser>();

  try {
    const rows = await prisma.$queryRaw<{ email: string | null; name: string | null }[]>`
      SELECT email,
             COALESCE(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name') AS name
      FROM auth.users
      WHERE deleted_at IS NULL
        AND email IS NOT NULL
        AND (banned_until IS NULL OR banned_until < now())
      ORDER BY email`;
    for (const r of rows) {
      if (r.email) byEmail.set(r.email.toLowerCase(), { email: r.email.toLowerCase(), name: r.name || null });
    }
  } catch {
    // no auth schema here — fall through to what the tasks already know
  }

  if (byEmail.size === 0) {
    const seen = await prisma.projectTask.findMany({
      where: { assignee: { not: null } },
      distinct: ["assignee"],
      select: { assignee: true },
    });
    for (const { assignee } of seen) {
      if (assignee) byEmail.set(assignee, { email: assignee, name: null });
    }
    const me = await currentUserEmail();
    if (me) byEmail.set(me, { email: me, name: null });
  }

  return [...byEmail.values()].sort((a, b) => a.email.localeCompare(b.email));
}

/** Email of the signed-in user, lowercased, or null (no auth / background work). */
export async function currentUserEmail(): Promise<string | null> {
  const actor = await currentActor();
  return actor === "system" ? null : actor.toLowerCase();
}

/** Loose email shape check — the directory decides who actually exists. */
export function isEmail(v: unknown): v is string {
  return typeof v === "string" && v.length <= 320 && /^[^\s@]+@[^\s@]+$/.test(v);
}
