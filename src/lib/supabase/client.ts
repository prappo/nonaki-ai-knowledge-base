import { createBrowserClient } from "@supabase/ssr";

// Without this, the cookie name is derived from the Supabase URL — client and
// server would derive different names whenever they use different URLs (see
// SUPABASE_INTERNAL_URL in middleware.ts), and the session would never be found.
const cookieOptions = { name: "sb-auth-token" };

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookieOptions }
  );
}
