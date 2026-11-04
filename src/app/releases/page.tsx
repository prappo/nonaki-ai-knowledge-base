"use client";

import { AgentConsole } from "@/components/AgentConsole";

/** Releases: the agent's Release Console for the repo (see AgentConsole). */
export default function ReleasesPage() {
  return <AgentConsole view="console" title="Releases" />;
}
