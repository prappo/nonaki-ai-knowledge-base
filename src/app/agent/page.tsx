"use client";

import { AgentConsole } from "@/components/AgentConsole";

/** Agent: Claude Code sessions in a repo on your laptop, like the terminal (see AgentConsole). */
export default function AgentPage() {
  return <AgentConsole view="agent" title="Agent" />;
}
