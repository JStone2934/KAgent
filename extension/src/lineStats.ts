export interface LineStats {
  added: number;
  removed: number;
  net: number;
}

export interface EditPatch {
  old_string?: string;
  new_string?: string;
}

export function countLines(text: string): number {
  if (!text) {
    return 0;
  }
  return toLineArray(text).length;
}

export function toLineArray(text: string): string[] {
  if (!text) {
    return [];
  }
  const parts = text.split("\n");
  if (parts.length > 0 && parts[parts.length - 1] === "") {
    parts.pop();
  }
  return parts;
}

export function countSemanticChangedLines(oldText: string, newText: string): number {
  if (oldText === newText) {
    return 0;
  }
  const oldLines = toLineArray(oldText);
  const newLines = toLineArray(newText);
  if (oldLines.length !== newLines.length) {
    return 0;
  }
  if (oldLines.length === 0) {
    return 1;
  }
  let changed = 0;
  for (let i = 0; i < oldLines.length; i++) {
    if (oldLines[i] !== newLines[i]) {
      changed++;
    }
  }
  return changed;
}

export function statsForTextPair(oldText: string, newText: string): LineStats {
  const oldLen = countLines(oldText);
  const newLen = countLines(newText);
  if (newLen > oldLen) {
    const added = newLen - oldLen;
    return { added, removed: 0, net: added };
  }
  if (newLen < oldLen) {
    const removed = oldLen - newLen;
    return { added: 0, removed, net: -removed };
  }
  const churn = countSemanticChangedLines(oldText, newText);
  return { added: churn, removed: churn, net: 0 };
}

function statsForEdit(edit: EditPatch): LineStats {
  return statsForTextPair(edit.old_string ?? "", edit.new_string ?? "");
}

export function computeEditStats(edits: EditPatch[] | undefined): LineStats {
  let added = 0;
  let removed = 0;
  for (const edit of edits ?? []) {
    const s = statsForEdit(edit);
    added += s.added;
    removed += s.removed;
  }
  return { added, removed, net: added - removed };
}

export function reconcileStatsWithFile(
  stats: LineStats,
  linesBefore: number,
  linesAfter: number
): LineStats {
  const fileDelta = linesAfter - linesBefore;
  if (stats.added === 0 && stats.removed === 0 && fileDelta !== 0) {
    if (fileDelta > 0) {
      return { added: fileDelta, removed: 0, net: fileDelta };
    }
    return { added: 0, removed: -fileDelta, net: fileDelta };
  }
  return stats;
}

export function simulateRoundExtremes(
  linesBefore: number,
  edits: EditPatch[] | undefined
): { high: number; low: number } {
  let current = linesBefore;
  let high = current;
  let low = current;
  for (const edit of edits ?? []) {
    const oldText = edit.old_string ?? "";
    const newText = edit.new_string ?? "";
    const oldLen = countLines(oldText);
    const newLen = countLines(newText);
    const delta = newLen - oldLen;

    if (delta !== 0) {
      current = Math.max(0, current + delta);
      high = Math.max(high, current);
      low = Math.min(low, current);
      continue;
    }

    const churn = countSemanticChangedLines(oldText, newText);
    if (churn > 0) {
      const afterDrop = Math.max(0, current - churn);
      low = Math.min(low, afterDrop);
      current = afterDrop + churn;
      high = Math.max(high, current);
    }
  }
  return { high, low };
}

export function contentHash(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16);
}
