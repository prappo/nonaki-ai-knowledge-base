import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getChunkCollection, CHUNK_COLLECTION } from "@/lib/weaviate";
import { PROVIDERS, isProvider, type AiProvider } from "@/lib/llm";
import { audit } from "@/lib/audit";

export const maxDuration = 60;

const DAY = 24 * 60 * 60 * 1000;

/** Profile data: signed-in user, AI token usage and vector DB usage. */
export async function GET() {
  const supabase = await createClient();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;

  const since = new Date(Date.now() - 30 * DAY);
  const [totals, byProvider, byOperation, recent, docStats] = await Promise.all([
    prisma.aiUsage.aggregate({
      _count: true,
      _sum: { inputTokens: true, outputTokens: true },
    }),
    prisma.aiUsage.groupBy({
      by: ["provider", "model"],
      _count: true,
      _sum: { inputTokens: true, outputTokens: true },
      orderBy: { provider: "asc" },
    }),
    prisma.aiUsage.groupBy({
      by: ["operation"],
      _count: true,
      _sum: { inputTokens: true, outputTokens: true },
      orderBy: { operation: "asc" },
    }),
    prisma.aiUsage.findMany({
      where: { createdAt: { gte: new Date(Date.now() - 14 * DAY) } },
      select: { createdAt: true, inputTokens: true, outputTokens: true },
    }),
    prisma.document.aggregate({
      where: { status: "indexed" },
      _count: true,
      _sum: { chunkCount: true },
    }),
  ]);

  // 14-day daily buckets for the mini chart
  const days: { date: string; tokens: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * DAY);
    days.push({ date: d.toISOString().slice(0, 10), tokens: 0 });
  }
  const byDate = new Map(days.map((d) => [d.date, d]));
  for (const row of recent) {
    const bucket = byDate.get(row.createdAt.toISOString().slice(0, 10));
    if (bucket) bucket.tokens += row.inputTokens + row.outputTokens;
  }

  // Vector DB usage — best effort, Weaviate may be unreachable
  let vector: { chunks: number; collection: string; embeddings: string } | null = null;
  try {
    const collection = await getChunkCollection();
    const agg = await collection.aggregate.overAll();
    vector = {
      chunks: agg.totalCount,
      collection: CHUNK_COLLECTION,
      embeddings: "text2vec-weaviate (Weaviate Cloud)",
    };
  } catch {
    vector = null;
  }

  // Which provider is active right now
  let activeProvider = "groq";
  try {
    const row = await prisma.setting.findUnique({ where: { key: "aiProvider" } });
    if (row && isProvider(row.value)) activeProvider = row.value;
  } catch {}

  return Response.json({
    user: user
      ? {
          email: user.email,
          name: (user.user_metadata?.full_name as string | undefined) ?? "",
          createdAt: user.created_at,
          lastSignInAt: user.last_sign_in_at,
        }
      : null,
    usage: {
      requests: totals._count,
      inputTokens: totals._sum.inputTokens ?? 0,
      outputTokens: totals._sum.outputTokens ?? 0,
      since,
      byProvider: byProvider.map((r) => ({
        provider: r.provider,
        label: isProvider(r.provider) ? PROVIDERS[r.provider as AiProvider].label : r.provider,
        model: r.model,
        requests: r._count,
        inputTokens: r._sum.inputTokens ?? 0,
        outputTokens: r._sum.outputTokens ?? 0,
      })),
      byOperation: byOperation.map((r) => ({
        operation: r.operation,
        requests: r._count,
        inputTokens: r._sum.inputTokens ?? 0,
        outputTokens: r._sum.outputTokens ?? 0,
      })),
      days,
    },
    activeProvider,
    vector,
    documents: {
      count: docStats._count,
      chunks: docStats._sum.chunkCount ?? 0,
    },
  });
}

/** Update the signed-in user's info: display name and/or password. */
export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  if (!supabase) {
    return Response.json({ error: "Authentication is not configured" }, { status: 400 });
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  const body = (await req.json()) as { name?: string; password?: string };
  const name = body.name?.trim();
  const password = body.password;

  if (name === undefined && !password) {
    return Response.json({ error: "Nothing to update" }, { status: 400 });
  }
  if (name !== undefined && name.length > 80) {
    return Response.json({ error: "Name is too long (max 80 characters)" }, { status: 400 });
  }
  if (password && password.length < 8) {
    return Response.json(
      { error: "Password must be at least 8 characters" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase.auth.updateUser({
    ...(name !== undefined ? { data: { full_name: name } } : {}),
    ...(password ? { password } : {}),
  });
  if (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  const changed = [
    ...(name !== undefined ? ["name"] : []),
    ...(password ? ["password"] : []),
  ];
  await audit("profile.updated", `Profile updated: ${changed.join(", ")}`, {
    entityType: "user",
    entityId: user.id,
    actor: user.email ?? "user",
  });

  return Response.json({
    user: {
      email: data.user.email,
      name: (data.user.user_metadata?.full_name as string | undefined) ?? "",
    },
  });
}
