import { prisma } from "./prisma";
import { retrieve } from "./rag";
import { docIdsForSources } from "./scope";
import { generateAnswer } from "./answer";
import { getNumberSetting } from "./settings";
import type { McpConfig } from "./share";

/**
 * Minimal MCP (Model Context Protocol) server — stateless Streamable HTTP.
 * Speaks plain JSON-RPC 2.0: initialize / ping / tools/list / tools/call,
 * which is everything Claude, Cursor & friends need for a tools-only server.
 */

export const MCP_PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
};

const rpcResult = (id: number | string | null, result: unknown) => ({
  jsonrpc: "2.0" as const,
  id,
  result,
});

const rpcError = (id: number | string | null, code: number, message: string) => ({
  jsonrpc: "2.0" as const,
  id,
  error: { code, message },
});

/** Tool output helper — MCP tools return a list of content blocks. */
const toolText = (text: string, isError = false) => ({
  content: [{ type: "text", text }],
  isError,
});

const TOOLS = [
  {
    name: "search_knowledge_base",
    description:
      "Search the knowledge base with hybrid (semantic + keyword) retrieval. " +
      "Returns the best-matching passages with their document ids, titles and relevance scores. " +
      "Use read_document to fetch a full document afterwards.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query" },
        limit: {
          type: "number",
          description: "Maximum number of passages to return (1-20, default 8)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "ask_knowledge_base",
    description:
      "Ask a question and get an AI-generated answer grounded in the knowledge base, " +
      "with numbered [n] citations and the source documents they refer to.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "The question to answer" },
      },
      required: ["question"],
    },
  },
  {
    name: "read_document",
    description:
      "Read the full content of one knowledge-base document by its id " +
      "(ids come from search_knowledge_base or ask_knowledge_base citations).",
    inputSchema: {
      type: "object",
      properties: {
        documentId: { type: "string", description: "The document id" },
      },
      required: ["documentId"],
    },
  },
] as const;

async function searchTool(config: McpConfig, args: Record<string, unknown>) {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) return toolText("query is required", true);
  const fallback = await getNumberSetting("retrievalLimit");
  const limit = Math.min(Math.max(Number(args.limit) || fallback, 1), 20);

  const docIds = await docIdsForSources(
    config.sourceIds.length > 0 ? config.sourceIds : undefined
  );
  const results = await retrieve(query, limit, docIds);
  if (results.length === 0) {
    return toolText("No matching passages found in the knowledge base.");
  }
  return toolText(
    JSON.stringify(
      results.map((r) => ({
        documentId: r.documentId,
        title: r.title,
        snippet: r.content.slice(0, 400),
        score: Number(r.score.toFixed(3)),
        url: r.url || undefined,
      })),
      null,
      2
    )
  );
}

async function askTool(config: McpConfig, args: Record<string, unknown>) {
  const question = typeof args.question === "string" ? args.question.trim() : "";
  if (!question) return toolText("question is required", true);

  const result = await generateAnswer(question, config.sourceIds, {
    operation: "mcp",
  });
  if (!result.found) {
    return toolText("The knowledge base has no information about that.");
  }

  prisma.askLog
    .create({
      data: {
        question,
        answer: result.answer,
        citations: JSON.stringify(result.citations),
        mode: "mcp",
      },
    })
    .catch(() => {});

  const sources = result.citations
    .map((c) => `[${c.n}] ${c.title} (documentId: ${c.documentId})`)
    .join("\n");
  return toolText(`${result.answer}\n\nSources:\n${sources}`);
}

async function readDocumentTool(config: McpConfig, args: Record<string, unknown>) {
  const id = typeof args.documentId === "string" ? args.documentId.trim() : "";
  if (!id) return toolText("documentId is required", true);

  const doc = await prisma.document.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      content: true,
      status: true,
      sourceId: true,
      updatedAt: true,
      source: { select: { name: true } },
    },
  });
  if (
    !doc ||
    doc.status !== "indexed" ||
    (config.sourceIds.length > 0 && !config.sourceIds.includes(doc.sourceId))
  ) {
    return toolText("Document not found.", true);
  }
  return toolText(
    `# ${doc.title}\nSource: ${doc.source?.name ?? "—"} · Updated: ${doc.updatedAt.toISOString()}\n\n${doc.content}`
  );
}

async function callTool(config: McpConfig, name: string, args: Record<string, unknown>) {
  switch (name) {
    case "search_knowledge_base":
      return searchTool(config, args);
    case "ask_knowledge_base":
      return askTool(config, args);
    case "read_document":
      return readDocumentTool(config, args);
    default:
      return null;
  }
}

/**
 * Handle one JSON-RPC message. Returns the response payload, or null for
 * notifications (which per Streamable HTTP get a body-less 202).
 */
export async function handleMcpMessage(
  config: McpConfig,
  message: JsonRpcRequest
): Promise<ReturnType<typeof rpcResult> | ReturnType<typeof rpcError> | null> {
  const { method, params = {} } = message;
  const id = message.id ?? null;

  // notifications (no id) — nothing to respond to
  if (message.id === undefined || method?.startsWith("notifications/")) return null;

  if (!method) return rpcError(id, -32600, "Invalid request: missing method");

  switch (method) {
    case "initialize": {
      const requested = params.protocolVersion;
      const protocolVersion =
        typeof requested === "string" && SUPPORTED_VERSIONS.includes(requested)
          ? requested
          : MCP_PROTOCOL_VERSION;
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "nonaki-knowledge-base", version: "1.0.0" },
        instructions:
          "Tools for a company knowledge base: search it, ask it questions " +
          "(AI answers with citations), and read full documents.",
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: TOOLS });
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      try {
        const result = await callTool(config, name, args);
        if (!result) return rpcError(id, -32602, `Unknown tool: ${name}`);
        return rpcResult(id, result);
      } catch {
        return rpcResult(
          id,
          toolText("The knowledge base is temporarily unavailable — try again.", true)
        );
      }
    }
    // tell resource/prompt-capable clients we have none rather than erroring
    case "resources/list":
      return rpcResult(id, { resources: [] });
    case "prompts/list":
      return rpcResult(id, { prompts: [] });
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}
