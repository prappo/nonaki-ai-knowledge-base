import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Auth gate. Everything requires a signed-in user EXCEPT the public surfaces:
 *  - /login                      the sign-in page itself
 *  - /embed/*                    chat widget iframe + public KB site
 *  - /widget.js                  embeddable launcher script
 *  - /api/embed/*                public ask/search/kb-data/doc APIs
 *  - /api/messenger/*            Meta webhook (has its own token/signature checks)
 *  - /api/mcp                    MCP server for AI clients (guarded by its API key)
 *  - /api/agent/*                release agents on laptops (guarded by their own tokens)
 *  - /api/cron/*                 Vercel Cron scheduler (guarded by CRON_SECRET)
 *  - GET /api/share/widget|kb    embed pages read their display config
 */
function isPublic(req: NextRequest): boolean {
  const { pathname } = req.nextUrl;
  if (pathname === "/login") return true;
  if (pathname === "/widget.js") return true;
  if (pathname.startsWith("/embed/") || pathname === "/embed") return true;
  if (pathname.startsWith("/api/embed/")) return true;
  if (pathname.startsWith("/api/messenger/")) return true;
  if (pathname === "/api/mcp") return true;
  if (pathname.startsWith("/api/agent/")) return true;
  if (pathname.startsWith("/api/cron/")) return true;
  if (
    req.method === "GET" &&
    (pathname === "/api/share/widget" || pathname === "/api/share/kb")
  ) {
    return true;
  }
  return false;
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  // Server-side code runs inside its own network context (e.g. a Docker
  // container), which may not reach Supabase at the same URL the browser
  // does — SUPABASE_INTERNAL_URL overrides just for server-side calls.
  const url = process.env.SUPABASE_INTERNAL_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    // Supabase not configured yet — let everything through so setup is possible
    return response;
  }

  const supabase = createServerClient(url, anonKey, {
    // See cookieOptions note in supabase/client.ts.
    cookieOptions: { name: "sb-auth-token" },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  // refreshes the session cookie if needed
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublic(request)) {
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    return NextResponse.redirect(loginUrl);
  }

  if (user && request.nextUrl.pathname === "/login") {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = "/";
    homeUrl.search = "";
    return NextResponse.redirect(homeUrl);
  }

  return response;
}

export const config = {
  matcher: [
    // everything except static assets and images
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
