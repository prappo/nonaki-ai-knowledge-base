/**
 * Reading a note's markdown: its preview, checklist progress and [[links]].
 * No server imports, so the Notes page uses the same rules as the API.
 */

/** A plain-text preview of a note's markdown. */
export function excerpt(markdown: string, length = 160): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*[-*+]\s+\[[ xX]\][ \t]*/gm, "")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, length);
}

/** Checklist progress, from markdown task items. */
export function checklist(markdown: string): { done: number; total: number } {
  const items = markdown.match(/^\s*[-*+]\s+\[[ xX]\]/gm) ?? [];
  return { total: items.length, done: items.filter((i) => /\[[xX]\]/.test(i)).length };
}

/** The titles a note links to with [[Title]], deduplicated, in order. */
export function wikiLinks(markdown: string): string[] {
  const seen = new Map<string, string>();
  for (const [, raw] of markdown.matchAll(/\[\[([^\[\]\n]{1,200})\]\]/g)) {
    const title = raw.trim();
    if (title && !seen.has(title.toLowerCase())) seen.set(title.toLowerCase(), title);
  }
  return [...seen.values()];
}

/** Word count, for the editor's footer. */
export function wordCount(markdown: string): number {
  const words = excerpt(markdown, Infinity).match(/[\p{L}\p{N}'’-]+/gu);
  return words?.length ?? 0;
}
