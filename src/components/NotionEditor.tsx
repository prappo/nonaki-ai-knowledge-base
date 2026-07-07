"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { Extension, type Range } from "@tiptap/core";
import { Suggestion, type SuggestionProps } from "@tiptap/suggestion";
import { htmlToMd, mdInlineToHtml, mdToHtml } from "@/lib/markdown";

/* ── slash commands ─────────────────────────────────────────── */

type SlashItem = {
  title: string;
  hint: string;
  icon: string;
  keywords: string;
  run: (editor: Editor, range: Range) => void;
};

const SLASH_ITEMS: SlashItem[] = [
  {
    title: "Text",
    hint: "Plain paragraph",
    icon: "¶",
    keywords: "text paragraph plain body",
    run: (e, r) => e.chain().focus().deleteRange(r).setParagraph().run(),
  },
  {
    title: "Heading 1",
    hint: "Large section heading",
    icon: "H1",
    keywords: "h1 heading title big",
    run: (e, r) => e.chain().focus().deleteRange(r).setNode("heading", { level: 1 }).run(),
  },
  {
    title: "Heading 2",
    hint: "Medium section heading",
    icon: "H2",
    keywords: "h2 heading subtitle",
    run: (e, r) => e.chain().focus().deleteRange(r).setNode("heading", { level: 2 }).run(),
  },
  {
    title: "Heading 3",
    hint: "Small section heading",
    icon: "H3",
    keywords: "h3 heading subheading",
    run: (e, r) => e.chain().focus().deleteRange(r).setNode("heading", { level: 3 }).run(),
  },
  {
    title: "Bullet list",
    hint: "Simple bulleted list",
    icon: "•",
    keywords: "ul unordered bullet list",
    run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run(),
  },
  {
    title: "Numbered list",
    hint: "List with numbering",
    icon: "1.",
    keywords: "ol ordered numbered list",
    run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run(),
  },
  {
    title: "Quote",
    hint: "Capture a quote or callout",
    icon: "❝",
    keywords: "quote blockquote citation callout",
    run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run(),
  },
  {
    title: "Code block",
    hint: "Monospaced code snippet",
    icon: "</>",
    keywords: "code snippet pre fence monospace",
    run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run(),
  },
  {
    title: "Divider",
    hint: "Horizontal separator line",
    icon: "—",
    keywords: "hr divider rule separator line",
    run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run(),
  },
];

type SlashRender = () => {
  onStart: (props: SuggestionProps<SlashItem, SlashItem>) => void;
  onUpdate: (props: SuggestionProps<SlashItem, SlashItem>) => void;
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
  onExit: () => void;
};

const SlashCommands = Extension.create<{ render: SlashRender | null }>({
  name: "slashCommands",

  addOptions() {
    return { render: null };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        char: "/",
        shouldShow: ({ editor }) => !editor.isActive("codeBlock"),
        command: ({ editor, range, props }) => props.run(editor, range),
        items: ({ query }) => {
          const q = query.toLowerCase().trim();
          return SLASH_ITEMS.filter(
            (i) => !q || i.title.toLowerCase().includes(q) || i.keywords.includes(q)
          );
        },
        render: this.options.render ?? undefined,
      }),
    ];
  },
});

/* ── AI quick actions (shared with the old textarea editor) ──── */

const AI_ACTIONS: { label: string; instruction: string }[] = [
  { label: "✦ Improve", instruction: "Improve the writing — clearer, tighter, better flow" },
  { label: "Shorten", instruction: "Make this significantly shorter without losing meaning" },
  {
    label: "Fix grammar",
    instruction: "Fix spelling, grammar and punctuation only — change nothing else",
  },
];

type PendingAi = {
  from: number;
  to: number;
  original: string;
  replacement: string;
  label: string;
};

type SlashMenuState = {
  items: SlashItem[];
  index: number;
  left: number;
  top: number;
  bottom: number;
};

/* ── component ──────────────────────────────────────────────── */

/**
 * Notion-style block editor. `value` is markdown (what we store & index);
 * the editor converts to rich blocks and back on every change.
 *
 * - Type "/" for the block menu (headings, lists, quote, code, divider)
 * - Select text for the formatting bubble + inline AI rewrite actions
 */
export function NotionEditor({
  value,
  onChange,
  title,
  placeholder,
  readOnly = false,
  autoFocus = false,
  wrapperClassName = "",
  contentClassName = "",
}: {
  value: string;
  onChange?: (markdown: string) => void;
  /** Document title, given to the AI as context. */
  title?: string;
  placeholder?: string;
  readOnly?: boolean;
  autoFocus?: boolean;
  wrapperClassName?: string;
  contentClassName?: string;
}) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const lastMd = useRef(value);

  const [slashMenu, setSlashMenu] = useState<SlashMenuState | null>(null);
  const slashRef = useRef<{ props: SuggestionProps<SlashItem, SlashItem>; index: number } | null>(
    null
  );

  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAi | null>(null);
  const [askAi, setAskAi] = useState<{ from: number; to: number; preview: string } | null>(null);
  const [askText, setAskText] = useState("");
  const lockedRef = useRef(false);

  const extensions = useMemo(() => {
    const syncSlash = (props: SuggestionProps<SlashItem, SlashItem>, index: number) => {
      const rect = props.clientRect?.();
      if (props.items.length === 0 || !rect) {
        slashRef.current = null;
        setSlashMenu(null);
        return;
      }
      const clamped = Math.min(index, props.items.length - 1);
      slashRef.current = { props, index: clamped };
      setSlashMenu({
        items: props.items,
        index: clamped,
        left: rect.left,
        top: rect.top,
        bottom: rect.bottom,
      });
    };

    return [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        underline: false, // markdown storage has no underline
        link: { openOnClick: false },
      }),
      Placeholder.configure({
        placeholder: placeholder ?? "Type '/' for commands, or just write…",
      }),
      ...(readOnly
        ? []
        : [
            SlashCommands.configure({
              render: () => ({
                onStart: (props) => syncSlash(props, 0),
                onUpdate: (props) => syncSlash(props, slashRef.current?.index ?? 0),
                onKeyDown: ({ event }) => {
                  const s = slashRef.current;
                  if (event.key === "Escape") {
                    slashRef.current = null;
                    setSlashMenu(null);
                    return true;
                  }
                  if (!s || s.props.items.length === 0) return false;
                  const n = s.props.items.length;
                  if (event.key === "ArrowDown") {
                    syncSlash(s.props, (s.index + 1) % n);
                    return true;
                  }
                  if (event.key === "ArrowUp") {
                    syncSlash(s.props, (s.index - 1 + n) % n);
                    return true;
                  }
                  if (event.key === "Enter" || event.key === "Tab") {
                    s.props.command(s.props.items[s.index]);
                    return true;
                  }
                  return false;
                },
                onExit: () => {
                  slashRef.current = null;
                  setSlashMenu(null);
                },
              }),
            }),
          ]),
    ];
  }, [readOnly, placeholder]);

  const editor = useEditor({
    immediatelyRender: false,
    editable: !readOnly,
    autofocus: autoFocus ? "end" : false,
    extensions,
    content: mdToHtml(value),
    editorProps: {
      attributes: { class: contentClassName },
    },
    onUpdate: ({ editor }) => {
      const md = htmlToMd(editor.getHTML());
      lastMd.current = md;
      onChangeRef.current?.(md);
    },
  });

  // Adopt external value changes (e.g. parent reloads the doc) without looping
  // on our own onChange emissions.
  useEffect(() => {
    if (!editor || value === lastMd.current) return;
    lastMd.current = value;
    editor.commands.setContent(mdToHtml(value), { emitUpdate: false });
  }, [value, editor]);

  const fmt = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            bold: e.isActive("bold"),
            italic: e.isActive("italic"),
            strike: e.isActive("strike"),
            code: e.isActive("code"),
            h1: e.isActive("heading", { level: 1 }),
            h2: e.isActive("heading", { level: 2 }),
            quote: e.isActive("blockquote"),
          }
        : null,
  });

  function lock(locked: boolean) {
    lockedRef.current = locked;
    editor?.setEditable(!locked && !readOnly);
  }

  async function runAi(range: { from: number; to: number }, instruction: string, label: string) {
    if (!editor || aiBusy || pending) return;
    const doc = editor.state.doc;
    const original = doc.textBetween(range.from, range.to, "\n");
    if (!original.trim()) return;
    setAiBusy(label);
    setAiError(null);
    lock(true);
    try {
      const res = await fetch("/api/assistant/inline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: original,
          instruction,
          title,
          before: doc.textBetween(Math.max(0, range.from - 500), range.from, "\n"),
          after: doc.textBetween(range.to, Math.min(doc.content.size, range.to + 500), "\n"),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Rewrite failed");
      setPending({ ...range, original, replacement: data.text as string, label });
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "Rewrite failed");
      lock(false);
    } finally {
      setAiBusy(null);
    }
  }

  function startAsk() {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    if (to <= from) return;
    const text = editor.state.doc.textBetween(from, to, "\n");
    setAskText("");
    setAskAi({ from, to, preview: text.length > 90 ? `${text.slice(0, 90)}…` : text });
  }

  function submitAsk() {
    const instruction = askText.trim();
    if (!askAi || !instruction) return;
    const label = instruction.length > 32 ? `${instruction.slice(0, 32)}…` : instruction;
    setAskAi(null);
    runAi(askAi, instruction, label);
  }

  function acceptAi() {
    if (!editor || !pending) return;
    const p = pending;
    const multiline = p.original.includes("\n") || p.replacement.includes("\n");
    const html = multiline ? mdToHtml(p.replacement) : mdInlineToHtml(p.replacement);
    setPending(null);
    lock(false);
    editor.chain().focus().insertContentAt({ from: p.from, to: p.to }, html).run();
  }

  function discardAi() {
    setPending(null);
    lock(false);
    editor?.chain().focus().run();
  }

  const menuBtn = (active: boolean) =>
    `rounded-md px-1.5 py-[3px] font-mono text-[11px] font-semibold transition-colors ${
      active ? "bg-teal-soft text-teal" : "text-slate hover:bg-hover hover:text-ink"
    }`;

  const slashOpenUp = slashMenu
    ? typeof window !== "undefined" && slashMenu.bottom + 300 > window.innerHeight
    : false;

  return (
    <div className={`notion-editor relative flex flex-col ${wrapperClassName}`}>
      {aiError && (
        <div className="sticky top-2 z-20 mb-3 flex-none rounded-lg border border-warn-line bg-warn-bg px-3 py-2 text-[11px] text-warn-text">
          {aiError}
          <button onClick={() => setAiError(null)} className="ml-2 font-semibold underline">
            dismiss
          </button>
        </div>
      )}

      {aiBusy && (
        <div className="sticky top-2 z-20 mb-3 flex-none self-start rounded-lg border border-teal-hairline bg-teal-mist px-3 py-2 text-[11px] font-semibold text-teal shadow-sm">
          <span className="pulse-dot">✦ {aiBusy}…</span>
        </div>
      )}

      {/* custom AI instruction for the selection */}
      {askAi && (
        <div className="sticky top-2 z-20 mb-3 flex-none rounded-lg border border-teal-hairline bg-teal-mist px-3 py-2.5 shadow-sm">
          <div className="font-mono text-[9px] uppercase tracking-[0.06em] text-teal">
            ✦ Edit selection with AI
          </div>
          <div className="mt-1.5 truncate rounded-md border border-line bg-card px-2.5 py-1.5 text-[11px] text-muted">
            “{askAi.preview}”
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input
              value={askText}
              onChange={(e) => setAskText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitAsk();
                }
                if (e.key === "Escape") setAskAi(null);
              }}
              autoFocus
              placeholder="Tell the AI what to do with the selection… ↵"
              className="min-w-0 flex-1 rounded-md border border-line bg-card px-2.5 py-1.5 text-[11.5px] outline-none placeholder:text-faint focus:border-teal"
            />
            <button
              onClick={submitAsk}
              disabled={!askText.trim()}
              className="rounded-md bg-teal px-2.5 py-1.5 text-[10.5px] font-semibold text-white hover:bg-teal-dark disabled:opacity-50"
            >
              Rewrite
            </button>
            <button
              onClick={() => setAskAi(null)}
              className="rounded-md px-2 py-1.5 text-[10.5px] font-semibold text-muted hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* AI suggestion review */}
      {pending && (
        <div className="sticky top-2 z-20 mb-3 flex-none rounded-lg border border-teal-hairline bg-teal-mist px-3 py-2.5 shadow-sm">
          <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.06em] text-teal">
            ✦ {pending.label}
            <span className="ml-auto flex gap-1.5">
              <button
                onClick={acceptAi}
                className="rounded-md bg-teal px-2.5 py-1 font-sans text-[10.5px] font-semibold normal-case tracking-normal text-white hover:bg-teal-dark"
              >
                Replace selection
              </button>
              <button
                onClick={discardAi}
                className="rounded-md border border-teal-line bg-card px-2.5 py-1 font-sans text-[10.5px] font-semibold normal-case tracking-normal text-slate hover:text-ink"
              >
                Discard
              </button>
            </span>
          </div>
          <div className="mt-2 max-h-40 overflow-y-auto scrollbar-thin rounded-lg border border-line bg-card px-3 py-2 text-[11.5px] leading-[1.6]">
            <div className="whitespace-pre-wrap bg-diff-del text-slate line-through decoration-diff-del-line">
              {pending.original}
            </div>
            <div className="mt-1.5 whitespace-pre-wrap bg-diff-add text-body">
              {pending.replacement}
            </div>
          </div>
        </div>
      )}

      <EditorContent editor={editor} className="min-h-0 flex-1" />

      {/* formatting + AI bubble on selection */}
      {editor && !readOnly && (
        <BubbleMenu
          editor={editor}
          options={{ placement: "top-start", offset: 8 }}
          shouldShow={({ editor: e, state }) => {
            if (lockedRef.current || !e.isEditable || e.isActive("codeBlock")) return false;
            const { empty, from, to } = state.selection;
            return !empty && state.doc.textBetween(from, to).trim().length > 0;
          }}
          className="z-[90] flex flex-col overflow-hidden rounded-[9px] border border-edge bg-card shadow-[0_10px_34px_rgba(10,20,25,0.18)]"
        >
          <div className="flex items-center gap-0.5 px-1.5 py-1">
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editor.chain().focus().toggleBold().run()}
              className={menuBtn(!!fmt?.bold)}
              title="Bold"
            >
              B
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editor.chain().focus().toggleItalic().run()}
              className={`${menuBtn(!!fmt?.italic)} italic`}
              title="Italic"
            >
              i
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editor.chain().focus().toggleStrike().run()}
              className={`${menuBtn(!!fmt?.strike)} line-through`}
              title="Strikethrough"
            >
              S
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editor.chain().focus().toggleCode().run()}
              className={menuBtn(!!fmt?.code)}
              title="Inline code"
            >
              {"</>"}
            </button>
            <span className="mx-1 h-4 w-px bg-hairline" />
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
              className={menuBtn(!!fmt?.h1)}
              title="Heading 1"
            >
              H1
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
              className={menuBtn(!!fmt?.h2)}
              title="Heading 2"
            >
              H2
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editor.chain().focus().toggleBlockquote().run()}
              className={menuBtn(!!fmt?.quote)}
              title="Quote"
            >
              ❝
            </button>
          </div>
          <div className="flex items-center gap-1 border-t border-hairline bg-panel px-1.5 py-1">
            {AI_ACTIONS.map((a) => (
              <button
                key={a.label}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => runAi(editor.state.selection, a.instruction, a.label)}
                className="rounded-md px-1.5 py-[3px] text-[10.5px] font-semibold text-teal transition-colors hover:bg-teal-soft"
              >
                {a.label}
              </button>
            ))}
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={startAsk}
              className="rounded-md px-1.5 py-[3px] text-[10.5px] font-semibold text-slate transition-colors hover:bg-hover hover:text-ink"
            >
              Ask AI…
            </button>
          </div>
        </BubbleMenu>
      )}

      {/* slash command menu */}
      {slashMenu && (
        <div
          className="fixed z-[95] w-[264px] overflow-hidden rounded-[10px] border border-edge bg-card py-1.5 shadow-[0_14px_44px_rgba(10,20,25,0.22)]"
          style={
            slashOpenUp
              ? { left: slashMenu.left, bottom: window.innerHeight - slashMenu.top + 6 }
              : { left: slashMenu.left, top: slashMenu.bottom + 6 }
          }
        >
          <div className="px-3 pb-1 pt-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-faint">
            Blocks
          </div>
          <div className="max-h-[264px] overflow-y-auto scrollbar-thin">
            {slashMenu.items.map((item, i) => (
              <button
                key={item.title}
                onMouseDown={(e) => {
                  e.preventDefault();
                  slashRef.current?.props.command(item);
                }}
                onMouseEnter={() => {
                  const s = slashRef.current;
                  if (s && s.index !== i) {
                    s.index = i;
                    setSlashMenu((m) => (m ? { ...m, index: i } : m));
                  }
                }}
                className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left ${
                  i === slashMenu.index ? "bg-teal-wash" : ""
                }`}
              >
                <span className="grid h-7 w-7 flex-none place-items-center rounded-md border border-line bg-panel font-mono text-[10px] font-semibold text-slate">
                  {item.icon}
                </span>
                <span className="min-w-0">
                  <span className="block text-[12px] font-semibold text-ink">{item.title}</span>
                  <span className="block truncate text-[10.5px] text-muted">{item.hint}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
