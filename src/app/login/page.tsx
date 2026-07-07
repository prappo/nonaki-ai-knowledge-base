"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Sign in — Nonaki";
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const supabase = createClient();
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        setNotice("Signed in — redirecting…");
        await new Promise((r) => setTimeout(r, 500));
        router.push("/");
        router.refresh();
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (data.session) {
          setNotice("Account created — redirecting…");
          await new Promise((r) => setTimeout(r, 500));
          router.push("/");
          router.refresh();
        } else {
          setNotice("Check your inbox — confirm your email, then sign in.");
          setMode("signin");
          setBusy(false);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-paper px-4">
      <div className="w-full max-w-[380px]">
        {/* brand */}
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <Image
            src="/logo.png?v=2"
            alt="Nonaki"
            width={40}
            height={46}
            className="h-[42px] w-auto"
            priority
          />
          <div className="leading-tight">
            <div className="text-[17px] font-bold tracking-[-0.01em]">Nonaki</div>
            <div className="font-mono text-[9px] tracking-[0.12em] text-muted">
              KNOWLEDGE BASE
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-card p-6 shadow-[0_8px_32px_rgba(10,20,25,0.08)]">
          <h1 className="text-[17px] font-semibold">
            {mode === "signin" ? "Welcome back" : "Create your account"}
          </h1>
          <p className="mt-0.5 text-xs text-muted">
            {mode === "signin"
              ? "Sign in to manage your knowledge base."
              : "Sign up with your email to get started."}
          </p>

          <form onSubmit={submit} className="mt-5 space-y-3">
            <label className="block">
              <span className="text-xs font-semibold">Email</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="mt-1 w-full rounded-lg border border-line bg-card px-3 py-2.5 text-[13px] outline-none focus:border-teal"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold">Password</span>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="mt-1 w-full rounded-lg border border-line bg-card px-3 py-2.5 text-[13px] outline-none focus:border-teal"
              />
            </label>

            {error && (
              <div className="rounded-lg border border-warn-line bg-warn-bg px-3 py-2 text-xs text-warn-text">
                {error}
              </div>
            )}
            {notice && (
              <div className="rounded-lg border border-green-soft bg-green-soft px-3 py-2 text-xs text-green-deep">
                {notice}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-teal py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-teal-dark disabled:opacity-60"
            >
              {busy ? "One moment…" : mode === "signin" ? "Sign in" : "Create account"}
            </button>
          </form>

          <div className="mt-4 text-center text-xs text-muted">
            {mode === "signin" ? (
              <>
                No account yet?{" "}
                <button
                  onClick={() => {
                    setMode("signup");
                    setError(null);
                  }}
                  className="font-semibold text-teal hover:text-teal-dark"
                >
                  Sign up
                </button>
              </>
            ) : (
              <>
                Already registered?{" "}
                <button
                  onClick={() => {
                    setMode("signin");
                    setError(null);
                  }}
                  className="font-semibold text-teal hover:text-teal-dark"
                >
                  Sign in
                </button>
              </>
            )}
          </div>
        </div>

        <p className="mt-4 text-center text-[10.5px] leading-relaxed text-faint">
          Tip: to keep this instance private, disable new sign-ups in
          Supabase → Authentication → Providers after creating your account.
        </p>
      </div>
    </div>
  );
}
