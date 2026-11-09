/** Starting points for a new note. `{date}` becomes today's date. */

export type NoteTemplate = { id: string; label: string; hint: string; title: string; content: string; tags?: string[] };

export const NOTE_TEMPLATES: NoteTemplate[] = [
  { id: "blank", label: "Blank note", hint: "Start from nothing", title: "", content: "" },
  {
    id: "meeting",
    label: "Meeting notes",
    hint: "Attendees, agenda, decisions, action items",
    title: "Meeting · {date}",
    tags: ["meeting"],
    content: `## Attendees

-

## Agenda

1.

## Notes

## Decisions

-

## Action items

- [ ] `,
  },
  {
    id: "daily",
    label: "Daily note",
    hint: "Today's focus, log and wrap-up",
    title: "{date}",
    tags: ["daily"],
    content: `## Focus

- [ ]

## Log

## Wrap-up

`,
  },
  {
    id: "brief",
    label: "Project brief",
    hint: "Problem, goals, scope, risks",
    title: "Brief: ",
    tags: ["brief"],
    content: `## Problem

## Goals

-

## Out of scope

-

## Risks and open questions

-

## Next steps

- [ ] `,
  },
  {
    id: "bug",
    label: "Bug report",
    hint: "Steps, expected, actual, environment",
    title: "Bug: ",
    tags: ["bug"],
    content: `## Steps to reproduce

1.

## Expected

## Actual

## Environment

- Version:
- Browser:

## Notes

`,
  },
  {
    id: "checklist",
    label: "Checklist",
    hint: "A plain to-do list",
    title: "",
    content: `- [ ] `,
  },
];

export function fillTemplate(t: NoteTemplate, now = new Date()) {
  const date = now.toLocaleDateString("en-CA"); // YYYY-MM-DD, local time
  return { title: t.title.replaceAll("{date}", date), content: t.content.replaceAll("{date}", date), tags: t.tags ?? [] };
}
