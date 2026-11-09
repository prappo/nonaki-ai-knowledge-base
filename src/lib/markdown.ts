import { Marked, marked } from "marked";
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
    // The editor's checklist items → GFM task items ("- [x] Done").
    turndown.addRule("taskItem", {
      filter: (node) =>
        node.nodeName === "LI" &&
        (node.getAttribute("data-type") === "taskItem" || (node.parentNode as HTMLElement | null)?.getAttribute?.("data-type") === "taskList"),
      replacement: (content, node) => {
        const checked = (node as HTMLElement).getAttribute("data-checked") === "true";
        const body = content.replace(/\u200b/g, "").trim().replace(/\n{2,}/g, "\n").replace(/\n/g, "\n  ");
        return `- [${checked ? "x" : " "}] ${body}\n`;
      },
    });
  }
  return turndown;
}

/**
 * marked, rendering GFM task lists ("- [x] Done") the way the editor's
 * checklist reads them: <ul data-type="taskList"><li data-type="taskItem"
 * data-checked="true">. A list with any task item becomes a checklist (its
 * plain items unchecked), since the editor can't mix the two in one list.
 */
const checklistMarked = new Marked({
  gfm: true,
  async: false,
  hooks: {
    // GFM needs text after "[ ]"; an empty checklist item (just added, not
    // yet typed in) would come back as a bullet reading "[ ]". A zero-width
    // space keeps it a task; saving strips it again.
    preprocess: (md) => md.replace(/^(\s*[-*+] +\[[ xX]\])[ \t]*$/gm, "$1 \u200b"),
  },
  renderer: {
    checkbox: () => "",
    list(token) {
      if (token.ordered || !token.items.some((item) => item.task)) return false;
      const items = token.items
        .map((item) => `<li data-type="taskItem" data-checked="${item.checked ? "true" : "false"}">${this.parser.parse(item.tokens)}</li>`)
        .join("");
      return `<ul data-type="taskList">${items}</ul>\n`;
    },
  },
});

/** Markdown (or plain text) → HTML for the editor. `checklists` keeps task lists as checklists. */
export function mdToHtml(markdown: string, { checklists = false }: { checklists?: boolean } = {}): string {
  if (checklists) return checklistMarked.parse(markdown, { async: false });
  return marked.parse(markdown, { async: false, gfm: true });
}

/** Markdown → inline HTML (no wrapping <p>), for splicing into a paragraph. */
export function mdInlineToHtml(markdown: string): string {
  return marked.parseInline(markdown, { async: false, gfm: true });
}

/** Editor HTML → markdown for storage/indexing. */
export function htmlToMd(html: string): string {
  // Turndown escapes brackets; keep [[Note title]] links readable as links.
  return getTurndown()
    .turndown(html)
    .replace(/\\\[\\\[([^\n]*?)\\\]\\\]/g, "[[$1]]");
}
