import { marked } from "marked";
import TurndownService from "turndown";

/**
 * Markdown ↔ HTML conversion for the Notion-style editor. Documents are
 * stored as markdown/plain text (chunked & indexed as-is); the editor works
 * on HTML, so we convert on the way in and out.
 */

let turndown: TurndownService | null = null;

function getTurndown() {
  if (!turndown) {
    turndown = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
      bulletListMarker: "-",
      emDelimiter: "*",
    });
    turndown.addRule("strikethrough", {
      filter: ["del", "s"],
      replacement: (content) => `~~${content}~~`,
    });
  }
  return turndown;
}

/** Markdown (or plain text) → HTML for the editor. */
export function mdToHtml(markdown: string): string {
  return marked.parse(markdown, { async: false, gfm: true });
}

/** Markdown → inline HTML (no wrapping <p>), for splicing into a paragraph. */
export function mdInlineToHtml(markdown: string): string {
  return marked.parseInline(markdown, { async: false, gfm: true });
}

/** Editor HTML → markdown for storage/indexing. */
export function htmlToMd(html: string): string {
  return getTurndown().turndown(html);
}
