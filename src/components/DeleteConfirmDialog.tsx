"use client";

import { useEffect, useState } from "react";

type DeleteConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  /** Warning banner text. Defaults to the archive (safe-delete) copy. */
  warning?: string;
  /** "archive" renders a softer banner; "danger" the red one. */
  tone?: "archive" | "danger";
  /** When set, the user must type this word to enable the confirm button. */
  requireText?: string;
  loading?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
};

export function DeleteConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Delete",
  warning = "This permanently removes the document content and its indexed chunks from Weaviate.",
  tone = "danger",
  requireText,
  loading = false,
  error,
  onCancel,
  onConfirm,
}: DeleteConfirmDialogProps) {
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (open) setTyped("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !loading) onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [loading, onCancel, open]);

  if (!open) return null;

  const confirmBlocked = Boolean(requireText) && typed.trim() !== requireText;

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-[80] grid place-items-center bg-black/35 px-4 backdrop-blur-[2px]"
      onMouseDown={() => {
        if (!loading) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-confirm-title"
        className="w-[420px] max-w-full overflow-hidden rounded-lg border border-line bg-card shadow-[0_18px_60px_rgba(10,20,25,0.28)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="border-b border-hairline px-5 py-4">
          <div className="flex items-start gap-3">
            <span
              className={`grid h-9 w-9 flex-none place-items-center rounded-full ${
                tone === "archive"
                  ? "bg-amber-soft text-amber"
                  : "bg-diff-del text-diff-del-line"
              }`}
            >
              {tone === "archive" ? (
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="2" y="4" width="20" height="5" rx="1" />
                  <path d="M4 9v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9" />
                  <path d="M10 13h4" />
                </svg>
              ) : (
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M3 6h18" />
                  <path d="M8 6V4h8v2" />
                  <path d="M19 6l-1 14H6L5 6" />
                  <path d="M10 11v5" />
                  <path d="M14 11v5" />
                </svg>
              )}
            </span>
            <div className="min-w-0">
              <h2 id="delete-confirm-title" className="text-[15px] font-semibold text-ink">
                {title}
              </h2>
              <p className="mt-1 text-[12px] leading-5 text-muted">{description}</p>
            </div>
          </div>
        </div>

        <div className="px-5 py-4">
          <div
            className={`rounded-lg border px-3 py-2.5 text-[11.5px] leading-5 ${
              tone === "archive"
                ? "border-amber-soft bg-amber-soft text-amber"
                : "border-warn-line bg-warn-bg text-warn-text"
            }`}
          >
            {warning}
          </div>
          {requireText && (
            <div className="mt-3">
              <div className="text-[11px] text-muted">
                Type <b className="font-mono text-ink">{requireText}</b> to confirm:
              </div>
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoFocus
                className="mt-1.5 w-full rounded-[7px] border border-line bg-card px-3 py-2 font-mono text-xs outline-none focus:border-diff-del-line"
              />
            </div>
          )}
          {error && (
            <div className="mt-3 rounded-lg border border-diff-del-line/40 bg-diff-del px-3 py-2 text-[11.5px] text-diff-del-line">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-hairline bg-panel px-5 py-3">
          <button
            onClick={onCancel}
            disabled={loading}
            className="rounded-md border border-edge bg-card px-3 py-1.5 text-[12px] font-semibold text-slate hover:border-teal hover:text-teal disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading || confirmBlocked}
            className={`rounded-md px-3.5 py-1.5 text-[12px] font-semibold text-white disabled:opacity-60 ${
              tone === "archive"
                ? "bg-teal hover:bg-teal-dark"
                : "bg-diff-del-line hover:bg-[#a85647]"
            }`}
          >
            {loading ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
