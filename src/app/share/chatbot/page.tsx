"use client";

import { useEffect, useState } from "react";
import { TopStrip } from "@/components/Shell";
import { SourcePicker } from "@/components/SourcePicker";
import { SharePageSkeleton } from "@/components/Skeleton";

type BotConfig = {
  enabled: boolean;
  verifyToken: string;
  pageToken: string;
  appSecret: string;
  sourceIds: string[];
  welcome: string;
  fallback: string;
  quickReplies: string[];
};

const PLATFORMS = [
  { id: "messenger", label: "Facebook Messenger", ready: true },
  { id: "instagram", label: "Instagram DM", ready: false },
  { id: "whatsapp", label: "WhatsApp", ready: false },
  { id: "telegram", label: "Telegram", ready: false },
] as const;

export default function ShareChatbotPage() {
  const [config, setConfig] = useState<BotConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
    fetch("/api/share/bot")
      .then((r) => r.json())
      .then((d) => setConfig(d.config));
  }, []);

  const patch = (p: Partial<BotConfig>) => setConfig((c) => (c ? { ...c, ...p } : c));

  async function save() {
    if (!config) return;
    setSaving(true);
    await fetch("/api/share/bot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    // re-read so secrets come back masked
    const d = await fetch("/api/share/bot").then((r) => r.json());
    setConfig(d.config);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function copy(text: string, which: string) {
    navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 1500);
  }

  async function pushProfile() {
    setProfileMsg(null);
    const res = await fetch("/api/messenger/setup-profile", { method: "POST" });
    const d = await res.json();
    setProfileMsg(res.ok ? "Get Started button + greeting pushed to your page ✓" : d.error);
  }

  if (!config) {
    return (
      <>
        <TopStrip crumb="Nonaki / Share / Chatbot" />
        <SharePageSkeleton />
      </>
    );
  }

  const webhookUrl = `${origin}/api/messenger/webhook`;

  return (
    <>
      <TopStrip
        crumb="Nonaki / Share / Chatbot"
        right={
          <span className={config.enabled ? "text-green" : ""}>
            {config.enabled ? "BOT ENABLED" : "BOT DISABLED"}
          </span>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin p-7">
        <div className="max-w-[720px]">
          <div className="flex items-baseline gap-2.5">
            <h1 className="text-[21px] font-semibold tracking-[-0.01em]">Social chatbot</h1>
            <span className="text-xs text-muted">
              answer customers on social messengers, straight from your knowledge base
            </span>
          </div>

          {/* platform tabs */}
          <div className="mt-4 flex flex-wrap gap-1.5">
            {PLATFORMS.map((p) => (
              <span
                key={p.id}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                  p.ready
                    ? "border-teal bg-teal-soft text-teal-dark"
                    : "cursor-not-allowed border-edge bg-card text-faint"
                }`}
              >
                {p.label}
                {!p.ready && (
                  <span className="rounded bg-chip px-1.5 py-px font-mono text-[8px] text-muted">
                    SOON
                  </span>
                )}
              </span>
            ))}
          </div>

          {/* enable + connection */}
          <div className="mt-4 space-y-4 rounded-xl border border-line bg-card p-4">
            <div className="flex items-center gap-3">
              <div className="font-mono text-[10px] tracking-[0.08em] text-muted">
                MESSENGER CONNECTION
              </div>
              <label className="ml-auto flex cursor-pointer items-center gap-2">
                <span className="text-xs font-semibold">
                  {config.enabled ? "Enabled" : "Disabled"}
                </span>
                <button
                  onClick={() => patch({ enabled: !config.enabled })}
                  className={`relative h-[19px] w-[34px] rounded-[10px] transition-colors ${
                    config.enabled ? "bg-teal" : "bg-edge"
                  }`}
                >
                  <span
                    className={`absolute top-[2.5px] h-3.5 w-3.5 rounded-full bg-white transition-all ${
                      config.enabled ? "right-[2.5px]" : "left-[2.5px]"
                    }`}
                  />
                </button>
              </label>
            </div>

            <div>
              <span className="text-xs font-semibold">Callback / Webhook URL</span>
              <div className="mt-1 flex gap-1.5">
                <code className="min-w-0 flex-1 truncate rounded-[7px] border border-line bg-chip px-3 py-2 font-mono text-[11px] text-slate">
                  {webhookUrl}
                </code>
                <button
                  onClick={() => copy(webhookUrl, "url")}
                  className="flex-none rounded-[7px] border border-teal-line px-3 py-2 text-[11px] font-semibold text-teal hover:bg-teal-soft"
                >
                  {copied === "url" ? "Copied ✓" : "Copy"}
                </button>
              </div>
              <div className="mt-1 text-[10.5px] text-faint">
                Note: Meta requires a public HTTPS URL — expose localhost with a tunnel
                (e.g. <span className="font-mono">ngrok http 3000</span>) or deploy first.
              </div>
            </div>

            <div>
              <span className="text-xs font-semibold">Verify token</span>
              <div className="mt-1 flex gap-1.5">
                <input
                  value={config.verifyToken}
                  onChange={(e) => patch({ verifyToken: e.target.value })}
                  className="min-w-0 flex-1 rounded-[7px] border border-line bg-card px-3 py-2 font-mono text-[11px] outline-none focus:border-teal"
                />
                <button
                  onClick={() => copy(config.verifyToken, "verify")}
                  className="flex-none rounded-[7px] border border-teal-line px-3 py-2 text-[11px] font-semibold text-teal hover:bg-teal-soft"
                >
                  {copied === "verify" ? "Copied ✓" : "Copy"}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-semibold">Page Access Token</span>
                <input
                  value={config.pageToken}
                  onChange={(e) => patch({ pageToken: e.target.value })}
                  type="password"
                  placeholder="EAAG… (from Meta App → Messenger → Settings)"
                  className="mt-1 w-full rounded-[7px] border border-line bg-card px-3 py-2 font-mono text-[11px] outline-none focus:border-teal"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold">
                  App Secret <span className="font-normal text-muted">(recommended)</span>
                </span>
                <input
                  value={config.appSecret}
                  onChange={(e) => patch({ appSecret: e.target.value })}
                  type="password"
                  placeholder="verifies webhook signatures"
                  className="mt-1 w-full rounded-[7px] border border-line bg-card px-3 py-2 font-mono text-[11px] outline-none focus:border-teal"
                />
              </label>
            </div>
          </div>

          {/* behaviour */}
          <div className="mt-4 space-y-4 rounded-xl border border-line bg-card p-4">
            <div className="font-mono text-[10px] tracking-[0.08em] text-muted">
              BOT BEHAVIOUR
            </div>
            <SourcePicker
              value={config.sourceIds}
              onChange={(sourceIds) => patch({ sourceIds })}
              label="Replies from these sources"
            />
            <label className="block">
              <span className="text-xs font-semibold">Welcome message</span>
              <span className="ml-1 text-[10.5px] text-muted">
                (sent on “Get Started” and used as the page greeting)
              </span>
              <textarea
                value={config.welcome}
                onChange={(e) => patch({ welcome: e.target.value })}
                rows={2}
                className="mt-1 w-full resize-none rounded-[7px] border border-line bg-card px-3 py-2 text-xs outline-none focus:border-teal"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold">Fallback message</span>
              <span className="ml-1 text-[10.5px] text-muted">
                (when nothing in the knowledge base matches)
              </span>
              <textarea
                value={config.fallback}
                onChange={(e) => patch({ fallback: e.target.value })}
                rows={2}
                className="mt-1 w-full resize-none rounded-[7px] border border-line bg-card px-3 py-2 text-xs outline-none focus:border-teal"
              />
            </label>
            <div>
              <span className="text-xs font-semibold">Quick replies</span>
              <span className="ml-1 text-[10.5px] text-muted">
                (suggestion chips under every answer — max 5, 20 chars each)
              </span>
              {config.quickReplies.map((q, i) => (
                <div key={i} className="mt-1.5 flex gap-1.5">
                  <input
                    value={q}
                    maxLength={20}
                    onChange={(e) => {
                      const next = [...config.quickReplies];
                      next[i] = e.target.value;
                      patch({ quickReplies: next });
                    }}
                    className="min-w-0 flex-1 rounded-[7px] border border-line bg-card px-3 py-1.5 text-xs outline-none focus:border-teal"
                  />
                  <button
                    onClick={() =>
                      patch({ quickReplies: config.quickReplies.filter((_, j) => j !== i) })
                    }
                    className="px-1.5 text-muted hover:text-orange"
                  >
                    ✕
                  </button>
                </div>
              ))}
              {config.quickReplies.length < 5 && (
                <button
                  onClick={() => patch({ quickReplies: [...config.quickReplies, ""] })}
                  className="mt-1.5 text-[11px] font-semibold text-teal hover:text-teal-dark"
                >
                  ＋ Add quick reply
                </button>
              )}
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2.5">
            <button
              onClick={save}
              disabled={saving}
              className="rounded-[7px] bg-teal px-5 py-2 text-xs font-semibold text-white hover:bg-teal-dark disabled:opacity-60"
            >
              {saving ? "Saving…" : saved ? "Saved ✓" : "Save chatbot"}
            </button>
            <button
              onClick={pushProfile}
              className="rounded-[7px] border border-teal-line px-4 py-2 text-xs font-semibold text-teal hover:bg-teal-soft"
            >
              Push “Get Started” button to page
            </button>
            {profileMsg && (
              <span className="text-[11px] text-muted">{profileMsg}</span>
            )}
          </div>

          {/* setup guide */}
          <div className="mt-5 rounded-xl border border-line bg-card p-4">
            <div className="font-mono text-[10px] tracking-[0.08em] text-muted">
              SETUP GUIDE — FACEBOOK MESSENGER
            </div>
            <ol className="mt-3 space-y-2.5 text-xs leading-relaxed text-slate">
              {[
                <>Go to <b>developers.facebook.com</b> → Create App → type <b>Business</b>, then add the <b>Messenger</b> product.</>,
                <>Under <b>Messenger → Messenger API Settings</b>, connect your Facebook Page and click <b>Generate token</b> — paste it above as the <b>Page Access Token</b>.</>,
                <>Copy your <b>App Secret</b> from App Settings → Basic and paste it above (enables webhook signature verification).</>,
                <>Under <b>Webhooks</b>, click Configure: paste the <b>Callback URL</b> and <b>Verify token</b> from above, then Verify & Save.</>,
                <>Subscribe the webhook to the <b>messages</b> and <b>messaging_postbacks</b> fields for your page.</>,
                <>Save the chatbot here with <b>Enabled</b> on, then message your page — the bot marks messages seen, shows a typing indicator, and answers from your knowledge base.</>,
              ].map((step, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="grid h-5 w-5 flex-none place-items-center rounded-full bg-teal-soft font-mono text-[10px] font-bold text-teal-dark">
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
            <div className="mt-3 rounded-lg border border-warn-line bg-warn-bg px-3 py-2 text-[11px] leading-relaxed text-warn-text">
              <b>Good to know:</b> Meta only lets pages reply within <b>24 hours</b> of the
              user&apos;s last message. Until your app passes App Review, only admins/testers
              of the app can message the bot. Quick replies keep conversations flowing, and
              a “Talk to a human” quick reply is your hand-off escape hatch.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
