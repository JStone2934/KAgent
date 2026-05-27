#!/usr/bin/env node
/**
 * Shared KAgent event recorder (used by hook + extension TS port).
 */
import fs from "node:fs";
import path from "node:path";

const STALE_MS = 30_000;
const MAX_WAIT_MS = 8_000;
const RETRY_MS = 25;

const DEFAULT_IGNORE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/.kagent/**",
  "**/dist/**",
  "**/out/**",
];

const DEFAULT_CAPTURE = {
  onSave: true,
  agentHook: true,
  coalesceWindowMs: 1500,
};

function sleep(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {}
}

function withLock(kagentDir, fn) {
  fs.mkdirSync(kagentDir, { recursive: true });
  const lockFile = path.join(kagentDir, ".lock");
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      fs.writeFileSync(lockFile, String(process.pid), { flag: "wx" });
      try {
        return fn();
      } finally {
        try {
          fs.unlinkSync(lockFile);
        } catch {}
      }
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      try {
        const stat = fs.statSync(lockFile);
        if (Date.now() - stat.mtimeMs > STALE_MS) fs.unlinkSync(lockFile);
      } catch {}
      sleep(RETRY_MS);
    }
  }
  throw new Error("KAgent: lock timeout");
}

function loadJson(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    }
  } catch {}
  return fallback;
}

function saveJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function appendNdjson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(obj) + "\n", "utf8");
}

function toLineArray(text) {
  if (!text) return [];
  const parts = text.split("\n");
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

function countLines(text) {
  if (!text) return 0;
  return toLineArray(text).length;
}

function countSemanticChangedLines(oldText, newText) {
  if (oldText === newText) return 0;
  const oldLines = toLineArray(oldText ?? "");
  const newLines = toLineArray(newText ?? "");
  if (oldLines.length !== newLines.length) return 0;
  if (oldLines.length === 0) return 1;
  let changed = 0;
  for (let i = 0; i < oldLines.length; i++) {
    if (oldLines[i] !== newLines[i]) changed++;
  }
  return changed;
}

function statsForTextPair(oldText, newText) {
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

function statsForEdit(edit) {
  return statsForTextPair(edit.old_string ?? "", edit.new_string ?? "");
}

function computeEditStats(edits) {
  let added = 0;
  let removed = 0;
  for (const edit of edits ?? []) {
    const s = statsForEdit(edit);
    added += s.added;
    removed += s.removed;
  }
  return { added, removed, net: added - removed };
}

function reconcileStatsWithFile(stats, linesBefore, linesAfter) {
  const fileDelta = linesAfter - linesBefore;
  if (stats.added === 0 && stats.removed === 0 && fileDelta !== 0) {
    if (fileDelta > 0) {
      return { added: fileDelta, removed: 0, net: fileDelta };
    }
    return { added: 0, removed: -fileDelta, net: fileDelta };
  }
  return stats;
}

function simulateRoundExtremes(linesBefore, edits) {
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

function contentHash(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16);
}

function loadConfig(kagentDir) {
  const disk = loadJson(path.join(kagentDir, "config.json"), {});
  return {
    ignoreGlobs: disk.ignoreGlobs ?? DEFAULT_IGNORE,
    capture: { ...DEFAULT_CAPTURE, ...disk.capture },
  };
}

function globToRegExp(glob) {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/{{GLOBSTAR}}/g, ".*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`^${escaped}$`);
}

function isIgnored(relativePath, config) {
  const normalized = relativePath.replace(/\\/g, "/");
  for (const glob of config.ignoreGlobs ?? []) {
    if (globToRegExp(glob).test(normalized)) return true;
  }
  return false;
}

function shouldCoalesce(kagentDir, existing, linesAfter, source, hashAfter, stats) {
  if (!existing?.last_ts) return false;
  const windowMs = loadConfig(kagentDir).capture.coalesceWindowMs ?? 1500;
  if (Date.now() - existing.last_ts > windowMs) return false;
  if (existing.last_lines !== linesAfter) return false;
  if (existing.last_content_hash === hashAfter) return true;
  if (stats.added === 0 && stats.removed === 0 && existing.last_lines === linesAfter) {
    return true;
  }
  if (source === "onSave" && existing.last_source === "afterFileEdit") {
    return true;
  }
  return false;
}

function readFileText(absPath) {
  try {
    if (!fs.existsSync(absPath)) return "";
    return fs.readFileSync(absPath, "utf8");
  } catch {
    return "";
  }
}

/**
 * @returns {{ recorded: boolean, reason?: string }}
 */
export function recordFileChange(input) {
  const kagentDir = path.join(input.workspaceRoot, ".kagent");
  const config = loadConfig(kagentDir);
  if (isIgnored(input.relativeFile, config)) {
    return { recorded: false, reason: "ignored" };
  }

  return withLock(kagentDir, () => {
    const symbolsPath = path.join(kagentDir, "symbols.json");
    const eventsPath = path.join(kagentDir, "events.ndjson");
    const symbolsDoc = loadJson(symbolsPath, { symbols: {} });
    const existing = symbolsDoc.symbols[input.relativeFile];
    const isIpo = !existing;
    const edits = input.edits;
    const absPath = path.join(input.workspaceRoot, input.relativeFile);
    const diskText = readFileText(absPath);
    const linesAfter = input.linesAfter ?? countLines(diskText);
    const hashAfter = contentHash(diskText);

    let linesBefore;
    let stats;
    let lines_high;
    let lines_low;

    if (input.oldText !== undefined) {
      const oldText = input.oldText;
      linesBefore = countLines(oldText);
      stats =
        edits?.length > 0
          ? reconcileStatsWithFile(computeEditStats(edits), linesBefore, linesAfter)
          : reconcileStatsWithFile(statsForTextPair(oldText, diskText), linesBefore, linesAfter);
      if (edits?.length > 0) {
        const { high: simHigh, low: simLow } = simulateRoundExtremes(linesBefore, edits);
        lines_high = Math.max(simHigh, linesBefore, linesAfter);
        lines_low = Math.min(simLow, linesBefore, linesAfter);
      } else {
        lines_high = Math.max(linesBefore, linesAfter);
        lines_low = Math.min(linesBefore, linesAfter);
      }
    } else if (existing && typeof existing.last_lines === "number") {
      linesBefore = existing.last_lines;
      if (edits?.length > 0) {
        stats = reconcileStatsWithFile(computeEditStats(edits), linesBefore, linesAfter);
        const { high: simHigh, low: simLow } = simulateRoundExtremes(linesBefore, edits);
        lines_high = Math.max(simHigh, linesBefore, linesAfter);
        lines_low = Math.min(simLow, linesBefore, linesAfter);
      } else {
        const delta = linesAfter - linesBefore;
        if (delta > 0) stats = { added: delta, removed: 0, net: delta };
        else if (delta < 0) stats = { added: 0, removed: -delta, net: delta };
        else stats = { added: 0, removed: 0, net: 0 };
        lines_high = Math.max(linesBefore, linesAfter);
        lines_low = Math.min(linesBefore, linesAfter);
      }
    } else {
      const preStats = computeEditStats(edits);
      linesBefore =
        preStats.net !== 0 ? Math.max(0, linesAfter - preStats.net) : linesAfter;
      stats = reconcileStatsWithFile(preStats, linesBefore, linesAfter);
      const { high: simHigh, low: simLow } = simulateRoundExtremes(linesBefore, edits);
      lines_high = Math.max(simHigh, linesBefore, linesAfter);
      lines_low = Math.min(simLow, linesBefore, linesAfter);
    }

    if (shouldCoalesce(kagentDir, existing, linesAfter, input.source, hashAfter, stats)) {
      return { recorded: false, reason: "coalesced" };
    }
    if (
      stats.added === 0 &&
      stats.removed === 0 &&
      linesBefore === linesAfter &&
      existing?.last_content_hash === hashAfter
    ) {
      return { recorded: false, reason: "unchanged" };
    }

    const editCount = (existing?.edit_count ?? 0) + 1;
    const ts = Date.now();
    const event = {
      v: 2,
      ts,
      conversation_id: input.conversation_id ?? null,
      generation_id: input.generation_id ?? null,
      file: input.relativeFile,
      added: stats.added,
      removed: stats.removed,
      net: stats.net,
      lines_before: linesBefore,
      lines_after: linesAfter,
      lines_high,
      lines_low,
      is_ipo: isIpo,
      edit_index: editCount,
      source: input.source,
      actor: input.actor ?? "unknown",
      editor: input.editor,
      save_reason: input.save_reason,
      content_hash_after: hashAfter,
    };

    appendNdjson(eventsPath, event);
    symbolsDoc.symbols[input.relativeFile] = {
      ipo_ts: existing?.ipo_ts ?? ts,
      edit_count: editCount,
      last_lines: linesAfter,
      last_ts: ts,
      delisted: false,
      last_source: input.source,
      last_content_hash: hashAfter,
    };
    saveJson(symbolsPath, symbolsDoc);
    return { recorded: true, event };
  });
}

export function countFileLines(absPath) {
  return countLines(readFileText(absPath));
}

export function recordFromHookPayload(payload, workspaceRoot, relativeFile) {
  const filePath = path.resolve(payload.file_path);
  const linesAfter = countFileLines(filePath);
  return recordFileChange({
    workspaceRoot,
    relativeFile,
    linesAfter,
    edits: payload.edits,
    source: payload.hook_event_name ?? "afterFileEdit",
    actor: "agent",
    conversation_id: payload.conversation_id,
    generation_id: payload.generation_id,
    editor: "cursor",
  });
}
