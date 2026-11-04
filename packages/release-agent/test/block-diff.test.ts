/** The visual comparison of user docs: Markdown lined up block by block. */

import { describe, expect, it } from "vitest";
import { changedFields, diffBlocks, markdownBlocks } from "../console/web/src/lib/blockDiff.ts";

describe("markdownBlocks", () => {
  it("keeps code fences and lists whole, even with blank lines inside", () => {
    const blocks = markdownBlocks("# Title\n\n```js\na();\n\nb();\n```\n\n- one\n\n- two\n\nEnd.\n");

    expect(blocks).toEqual(["# Title", "```js\na();\n\nb();\n```", "- one\n\n- two", "End."]);
  });
});

describe("diffBlocks", () => {
  it("marks a changed paragraph as removed then added, around the unchanged ones", () => {
    const blocks = diffBlocks("# Setup\n\nStep one.\n\nDone.\n", "# Setup\n\nStep one, revised.\n\n![Shot](a.png)\n\nDone.\n");

    expect(blocks.map((block) => `${block.change}:${block.text}`)).toEqual([
      "same:# Setup",
      "removed:Step one.",
      "added:Step one, revised.",
      "added:![Shot](a.png)",
      "same:Done.",
    ]);
  });

  it("ignores changes to the spacing between blocks", () => {
    expect(diffBlocks("A\n\nB\n", "A\n\n\n\nB").every((block) => block.change === "same")).toBe(true);
  });

  it("shows a new article as all added", () => {
    expect(diffBlocks("", "# New\n\nText.").map((block) => block.change)).toEqual(["added", "added"]);
  });
});

describe("changedFields", () => {
  it("lists only fields whose value changed, added or dropped", () => {
    expect(changedFields({ title: "Old", slug: "s", tag: "x" }, { title: "New", slug: "s", order: "2" })).toEqual([
      { key: "title", before: "Old", after: "New" },
      { key: "order", before: null, after: "2" },
      { key: "tag", before: "x", after: null },
    ]);
  });
});
