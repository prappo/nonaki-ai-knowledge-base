export type DiffLine = { text: string; type: "same" | "del" | "add" };

export type DiffHunk =
  | { type: "same"; lines: string[] }
  | { type: "change"; oldLines: string[]; newLines: string[] };

/**
 * Group a line diff into hunks: unchanged runs and change blocks (paired
 * deletions/additions). Used for section-by-section review — accepted change
 * hunks take `newLines`, rejected ones keep `oldLines`.
 */
export function diffHunks(oldText: string, newText: string): DiffHunk[] {
  const { left, right } = diffLines(oldText, newText);
  const hunks: DiffHunk[] = [];
  let i = 0;
  let j = 0;

  const push = (hunk: DiffHunk) => hunks.push(hunk);

  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i].type === "same" && right[j].type === "same") {
      const lines: string[] = [];
      while (
        i < left.length &&
        j < right.length &&
        left[i].type === "same" &&
        right[j].type === "same"
      ) {
        lines.push(left[i].text);
        i++;
        j++;
      }
      push({ type: "same", lines });
    } else {
      const oldLines: string[] = [];
      const newLines: string[] = [];
      while (i < left.length && left[i].type === "del") oldLines.push(left[i++].text);
      while (j < right.length && right[j].type === "add") newLines.push(right[j++].text);
      if (oldLines.length === 0 && newLines.length === 0) {
        // aligned "same" pairs are handled above; this only guards malformed input
        if (i < left.length) oldLines.push(left[i++].text);
        if (j < right.length) newLines.push(right[j++].text);
      }
      push({ type: "change", oldLines, newLines });
    }
  }
  return hunks;
}

/** Reassemble content from hunks, taking `newLines` only for accepted change hunks. */
export function applyHunks(hunks: DiffHunk[], accepted: Set<number>): string {
  const out: string[] = [];
  hunks.forEach((hunk, index) => {
    if (hunk.type === "same") out.push(...hunk.lines);
    else if (accepted.has(index)) out.push(...hunk.newLines);
    else out.push(...hunk.oldLines);
  });
  return out.join("\n");
}

/**
 * Simple line-based LCS diff, good enough for doc review.
 * Returns aligned views: `left` (current, deletions marked) and
 * `right` (proposed, additions marked).
 */
export function diffLines(oldText: string, newText: string): {
  left: DiffLine[];
  right: DiffLine[];
} {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  const n = a.length;
  const m = b.length;

  // Cap LCS table size for very large docs — fall back to whole-block diff
  if (n * m > 4_000_000) {
    return {
      left: a.map((text) => ({ text, type: "del" as const })),
      right: b.map((text) => ({ text, type: "add" as const })),
    };
  }

  const dp: Uint32Array[] = Array.from(
    { length: n + 1 },
    () => new Uint32Array(m + 1)
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const left: DiffLine[] = [];
  const right: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      left.push({ text: a[i], type: "same" });
      right.push({ text: b[j], type: "same" });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      left.push({ text: a[i], type: "del" });
      i++;
    } else {
      right.push({ text: b[j], type: "add" });
      j++;
    }
  }
  while (i < n) left.push({ text: a[i++], type: "del" });
  while (j < m) right.push({ text: b[j++], type: "add" });

  return { left, right };
}
