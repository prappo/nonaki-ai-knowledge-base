import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { prisma } from "./prisma";

/**
 * Append an entry to the audit log. Never throws — auditing must not break
 * the action being audited.
 *
 * Pass `actor` explicitly when calling from background work (after() callbacks,
 * cron) where there is no request context; otherwise it is resolved from the
 * current Supabase session.
 */
export async function audit(
  action: string,
  summary: string,
  opts: {
    entityType?: string;
    entityId?: string;
    detail?: unknown;
    actor?: string;
  } = {}
): Promise<void> {
  try {
    const actor = opts.actor ?? (await currentActor());
    await prisma.auditLog.create({
      data: {
        action,
        summary,
        entityType: opts.entityType,
        entityId: opts.entityId,
        detail: opts.detail === undefined ? undefined : JSON.stringify(opts.detail),
        actor,
      },
    });
  } catch {
    /* best-effort */
  }
}

/**
 * Email of the signed-in user for the current request, or "system" when
 * there is no request context (background jobs) or Supabase isn't configured.
 */
export async function currentActor(): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return "system";
  try {
    const store = await cookies();
    const supabase = createServerClient(url, anonKey, {
      cookies: {
        getAll: () => store.getAll(),
        setAll: () => {}, // read-only: never mutate cookies from audit reads
      },
    });
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user?.email ?? "system";
  } catch {
    return "system"; // no request scope (e.g. inside after()/cron)
  }
}
