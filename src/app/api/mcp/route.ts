import { NextRequest } from "next/server";
import { getShareConfig, type McpConfig } from "@/lib/share";
import { agentFromRequest } from "@/lib/releases";
import { handleMcpMessage, MCP_PROTOCOL_VERSION } from "@/lib/mcp";

export const maxDuration = 300;

/**
 * MCP endpoint (Streamable HTTP, stateless). AI clients connect here with
 * the API key from Share → MCP server as a Bearer token. The middleware
 * lets this route through — auth is the key check below.
 *
 * Paired release agents connect with their own agent token instead and get
 * everything by default: every source, and read/write Projects and tasks —
 * whether or not the public MCP share is switched on.
 */

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
};

function bearerToken(req: NextRequest): string {
  const header = req.headers.get("authorization") ?? "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

/** Full access for a paired agent's token, or null for anything else. */
async function agentConfig(req: NextRequest, shared: McpConfig): Promise<McpConfig | null> {
  if (!bearerToken(req).startsWith("nk_agent_")) return null;
  const agent = await agentFromRequest(req);
  return agent ? { ...shared, enabled: true, sourceIds: [], projectAccess: "write" } : null;
}

export async function POST(req: NextRequest) {
  const shared = await getShareConfig("mcp");
  const fromAgent = await agentConfig(req, shared);
  const config = fromAgent ?? shared;
  if (!fromAgent && !config.enabled) {
    return Response.json(
      { error: "MCP server is disabled — enable it under Share → MCP server" },
      { status: 403 }
    );
  }
  if (!fromAgent && (!config.apiKey || bearerToken(req) !== config.apiKey)) {
    return Response.json(
      { error: "Unauthorized — pass the MCP API key as a Bearer token" },
      { status: 401, headers: { "WWW-Authenticate": "Bearer" } }
    );
  }

  let message;
  try {
    message = await req.json();
  } catch {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { status: 400, headers: JSON_HEADERS }
    );
  }
  if (Array.isArray(message)) {
    // JSON-RPC batching was removed in MCP 2025-06-18 — answer each anyway
    const responses = (
      await Promise.all(message.map((m) => handleMcpMessage(config, m)))
    ).filter((r) => r !== null);
    if (responses.length === 0) return new Response(null, { status: 202 });
    return Response.json(responses, { headers: JSON_HEADERS });
  }

  const response = await handleMcpMessage(config, message);
  // notifications get an empty 202 per the Streamable HTTP transport
  if (response === null) return new Response(null, { status: 202 });
  return Response.json(response, { headers: JSON_HEADERS });
}

// Stateless server: no server-initiated streams, no sessions to delete.
export async function GET() {
  return Response.json(
    { error: "Method not allowed — POST JSON-RPC messages to this endpoint" },
    { status: 405, headers: { Allow: "POST" } }
  );
}

export async function DELETE() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
