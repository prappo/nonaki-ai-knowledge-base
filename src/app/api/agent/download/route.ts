import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { agentFromRequest } from "@/lib/releases";

/** Built into the image by the Dockerfile (or `npm run build:agent` locally). */
const TARBALL = path.join(process.cwd(), "agent", "release-agent.tgz");

/**
 * The release-agent package, for `npm install -g "<this url>?code=XXXX-XXXX"`.
 * Needs a pairing code that hasn't expired (used ones are fine: you install,
 * then pair), or a paired agent's token (for updates). Not public: it carries
 * the built-in recipes.
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code")?.trim().toUpperCase() ?? "";
  const allowed =
    (code && (await prisma.releasePairing.count({ where: { code, expiresAt: { gt: new Date() } } })) > 0) ||
    (await agentFromRequest(req)) !== null;
  if (!allowed) {
    return Response.json({ error: "Make a pairing code on the Releases page and use the link it shows." }, { status: 403 });
  }

  let file: Buffer;
  try {
    file = await readFile(TARBALL);
  } catch {
    return Response.json({ error: "This server has no agent package built (run `npm run build:agent`)." }, { status: 404 });
  }
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": 'attachment; filename="release-agent.tgz"',
      "Cache-Control": "no-store",
    },
  });
}
