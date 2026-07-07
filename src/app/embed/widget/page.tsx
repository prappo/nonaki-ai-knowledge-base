"use client";

import { useEffect, useState } from "react";
import { WidgetChat, type WidgetChatConfig } from "@/components/WidgetChat";

/** Standalone chat page loaded inside the iframe injected by /widget.js */
export default function EmbedWidgetPage() {
  const [config, setConfig] = useState<WidgetChatConfig | null>(null);

  useEffect(() => {
    fetch("/api/share/widget")
      .then((r) => r.json())
      .then((d) => {
        setConfig(d.config);
        document.title = d.config?.name ?? "Chat";
      })
      .catch(() =>
        setConfig({
          name: "Assistant",
          greeting: "Hi! Ask me anything.",
          color: "#0e7f93",
          showCitations: true,
          suggestions: [],
        })
      );
  }, []);

  if (!config) {
    return (
      <div className="grid h-screen place-items-center bg-white text-xs text-[#9aa6ab]">
        Loading…
      </div>
    );
  }
  return (
    <div className="h-screen">
      <WidgetChat config={config} surface="widget" />
    </div>
  );
}
