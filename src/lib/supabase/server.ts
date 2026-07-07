import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Cookie-bound Supabase client for Route Handlers / Server Components.
 * Returns null when Supabase isn't configured (local setup without auth).
 */
export async function createClient() {
  // See SUPABASE_INTERNAL_URL note in middleware.ts.
  const url = process.env.SUPABASE_INTERNAL_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  const cookieStore = await cookies();
  return createServerClient(url, anonKey, {
    // See cookieOptions note in supabase/client.ts.
    cookieOptions: { name: "sb-auth-token" },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // called from a Server Component — middleware refreshes sessions
        }
      },
    },
  });
}
