import { randomUUID } from "node:crypto";

/**
 * The tunnel between the Releases page and an agent's local Release Console.
 *
 * A browser request to /api/releases/console/<agent>/<repo>/api/... is queued
 * here; the agent's open long-poll (/api/agent/commands) picks it up at once,
 * the agent makes the same request to its console on 127.0.0.1, and streams
 * the response back through /api/agent/rpc. Event streams (run events) stay
 * open until the browser goes away.
 *
 * In-memory on purpose: one app process, and nothing here needs to survive a
 * restart (an interrupted request is simply retried by the UI).
 */

export interface RpcRequest {
  id: string;
  repoId: string;
  method: "GET" | "POST";
  /** Path on the console, starting with /api/. */
  path: string;
  query: string;
  contentType: string | null;
  /** Request body, base64 (POST only). */
  body: string | null;
}

export interface RpcHead {
  status: number;
  headers: Record<string, string>;
}

interface Pending {
  agentId: string;
  onHead: (head: RpcHead) => void;
  onChunk: (data: Uint8Array) => void;
  onEnd: () => void;
  onError: (message: string) => void;
}

class Tunnel {
  private readonly queues = new Map<string, RpcRequest[]>();
  private readonly cancels = new Map<string, string[]>();
  private readonly wakers = new Map<string, Set<() => void>>();
  private readonly pending = new Map<string, Pending>();

  private wake(agentId: string) {
    for (const wake of this.wakers.get(agentId) ?? []) wake();
  }

  send(agentId: string, request: Omit<RpcRequest, "id">, handlers: Omit<Pending, "agentId">): string {
    const id = randomUUID();
    this.pending.set(id, { agentId, ...handlers });
    this.queues.set(agentId, [...(this.queues.get(agentId) ?? []), { id, ...request }]);
    this.wake(agentId);
    return id;
  }

  /** The browser went away: forget the request and tell the agent to drop it. */
  cancel(id: string) {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    const queued = this.queues.get(p.agentId) ?? [];
    if (queued.some((r) => r.id === id)) {
      this.queues.set(p.agentId, queued.filter((r) => r.id !== id));
      return;
    }
    this.cancels.set(p.agentId, [...(this.cancels.get(p.agentId) ?? []), id]);
    this.wake(p.agentId);
  }

  /** Work for an agent's long-poll. */
  take(agentId: string): { rpc: RpcRequest[]; cancel: string[] } {
    const rpc = this.queues.get(agentId) ?? [];
    const cancel = this.cancels.get(agentId) ?? [];
    this.queues.delete(agentId);
    this.cancels.delete(agentId);
    return { rpc, cancel };
  }

  hasWork(agentId: string): boolean {
    return (this.queues.get(agentId)?.length ?? 0) > 0 || (this.cancels.get(agentId)?.length ?? 0) > 0;
  }

  /** Resolve after `ms`, or as soon as there's work for the agent. */
  waitForWork(agentId: string, ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (this.hasWork(agentId)) return resolve();
      const set = this.wakers.get(agentId) ?? new Set();
      this.wakers.set(agentId, set);
      const done = () => {
        clearTimeout(timer);
        set.delete(done);
        signal.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      set.add(done);
      signal.addEventListener("abort", done);
    });
  }

  /** A response part from an agent. Only the agent a request was sent to may answer it. */
  receive(agentId: string, part: { id: string; type: "head" | "chunk" | "end" | "error"; status?: number; headers?: Record<string, string>; data?: string; error?: string }) {
    const p = this.pending.get(part.id);
    if (!p || p.agentId !== agentId) return;
    if (part.type === "head") p.onHead({ status: part.status ?? 502, headers: part.headers ?? {} });
    else if (part.type === "chunk" && part.data) p.onChunk(Buffer.from(part.data, "base64"));
    else if (part.type === "end") {
      this.pending.delete(part.id);
      p.onEnd();
    } else if (part.type === "error") {
      this.pending.delete(part.id);
      p.onError(part.error ?? "The agent couldn't reach its console.");
    }
  }

  /** The agent disconnected: fail everything it owed. */
  failAgent(agentId: string, message: string) {
    for (const [id, p] of this.pending) {
      if (p.agentId !== agentId) continue;
      this.pending.delete(id);
      p.onError(message);
    }
    this.queues.delete(agentId);
  }
}

const g = globalThis as unknown as { releaseTunnel?: Tunnel };
export const tunnel = (g.releaseTunnel ??= new Tunnel());
