"use client";

import Image from "next/image";
import { useState } from "react";

/** Official WordPress mark (simplified), fill = currentColor. */
export function WordPressMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 0C5.385 0 0 5.385 0 12s5.385 12 12 12 12-5.385 12-12S18.615 0 12 0zM1.2 12c0-1.565.335-3.052.936-4.394L7.28 21.712A10.804 10.804 0 0 1 1.2 12zM12 22.8c-1.06 0-2.084-.155-3.052-.441l3.242-9.418 3.32 9.096c.022.053.048.102.077.149A10.77 10.77 0 0 1 12 22.8zm1.489-15.861c.65-.034 1.236-.103 1.236-.103.582-.068.513-.923-.069-.889 0 0-1.749.137-2.878.137-1.06 0-2.843-.137-2.843-.137-.582-.034-.65.855-.068.889 0 0 .55.069 1.132.103l1.682 4.61-2.364 7.089L5.35 6.94c.65-.034 1.235-.103 1.235-.103.582-.068.513-.923-.069-.889 0 0-1.746.137-2.874.137-.202 0-.441-.005-.695-.013A10.786 10.786 0 0 1 12 1.2c2.809 0 5.367 1.074 7.286 2.833-.046-.003-.092-.009-.14-.009-1.06 0-1.812.923-1.812 1.914 0 .889.513 1.641 1.06 2.53.41.72.889 1.642.889 2.976 0 .924-.355 1.996-.82 3.489l-1.077 3.595-3.897-11.589zm3.952 14.394l3.306-9.556c.617-1.544.822-2.779.822-3.877 0-.399-.026-.769-.073-1.114A10.755 10.755 0 0 1 22.8 12c0 3.99-2.163 7.473-5.359 9.333z" />
    </svg>
  );
}

/** GitHub octocat mark, fill = currentColor. */
export function GitHubMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57C20.565 21.795 24 17.31 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

/** Upload-source mark (tray with up arrow), stroke = currentColor. */
export function UploadMark({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 15V3" />
      <path d="M7 8l5-5 5 5" />
      <path d="M3 15v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4" />
    </svg>
  );
}

/** Manual-entry mark (pen writing a line), stroke = currentColor. */
export function ManualMark({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

/**
 * Source avatar chip. WordPress sources show the site's favicon (via Google's
 * favicon service) and fall back to the WordPress mark if it can't be loaded;
 * everything else gets its brand mark.
 */
export function SourceIcon({
  type,
  siteUrl,
  size = 34,
  rounded = "lg",
}: {
  type: string;
  siteUrl?: string;
  size?: number;
  rounded?: "lg" | "full";
}) {
  const [faviconFailed, setFaviconFailed] = useState(false);
  const radius = rounded === "full" ? "rounded-full" : "rounded-lg";

  let domain: string | null = null;
  if (type === "wordpress" && siteUrl) {
    try {
      domain = new URL(siteUrl).hostname;
    } catch {
      domain = null;
    }
  }

  const markSize = Math.round(size * 0.52);

  if (domain && !faviconFailed) {
    return (
      <span
        className={`grid flex-none place-items-center overflow-hidden border border-hairline bg-card ${radius}`}
        style={{ width: size, height: size }}
        title={domain}
      >
        <Image
          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`}
          alt=""
          width={markSize + 4}
          height={markSize + 4}
          className="rounded-[4px]"
          onError={() => setFaviconFailed(true)}
        />
      </span>
    );
  }

  return (
    <span
      className={`grid flex-none place-items-center ${radius} ${
        type === "wordpress"
          ? "bg-wp-chip text-wp-ink"
          : type === "upload"
            ? "bg-up-chip text-up-ink"
            : type === "manual"
              ? "bg-teal-soft text-teal-dark"
              : "bg-gh-chip text-gh-ink"
      }`}
      style={{ width: size, height: size }}
    >
      {type === "wordpress" ? (
        <WordPressMark size={markSize} />
      ) : type === "upload" ? (
        <UploadMark size={markSize} />
      ) : type === "manual" ? (
        <ManualMark size={markSize} />
      ) : (
        <GitHubMark size={markSize} />
      )}
    </span>
  );
}
