#!/usr/bin/env node
/**
 * KAgent capture hook — records agent file edits as stock-like events.
 * stdin: Cursor afterFileEdit JSON payload
 */
import fs from "node:fs";
import path from "node:path";

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return null;
  return JSON.parse(raw);
}

function loadJson(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    }
  } catch {
    /* ignore */
  }
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

function countLines(text) {
  if (!text) return 0;
  return toLineArray(text).length;
}

/** 与 countLines 一致的行数组（不含末尾空行） */
function toLineArray(text) {
  if (!text) return [];
  const parts = text.split("\n");
  if (parts.length > 0 && parts[parts.length - 1] === "") {
    parts.pop();
  }
  return parts;
}

/**
 * 行数相同但内容不同时，统计被改写的行数。
 * 用于 K 线波动：同时计入删与增（净行数不变，同轮可拆为先跌后涨）。
 */
function countSemanticChangedLines(oldText, newText) {
  const oldStr = oldText ?? "";
  const newStr = newText ?? "";
  if (oldStr === newStr) return 0;

  const oldLines = toLineArray(oldStr);
  const newLines = toLineArray(newStr);
  if (oldLines.length !== newLines.length) return 0;

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

function statsForEdit(edit) {
  const oldText = edit.old_string ?? "";
  const newText = edit.new_string ?? "";
  const oldLen = countLines(oldText);
  const newLen = countLines(newText);

  if (newLen > oldLen) {
    return { added: newLen - oldLen, removed: 0 };
  }
  if (newLen < oldLen) {
    return { added: 0, removed: oldLen - newLen };
  }

  const churn = countSemanticChangedLines(oldText, newText);
  return { added: churn, removed: churn };
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

/** 用磁盘行数差补齐 edits 未反映的净增删（兜底） */
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

/** 模拟一轮内多次 patch 时行数轨迹，得到该轮最高/最低行数 */
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

function loadConfig(kagentDir) {
  return loadJson(path.join(kagentDir, "config.json"), { ignoreGlobs: [] });
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
    if (globToRegExp(glob).test(normalized)) {
      return true;
    }
  }
  return false;
}

function resolveWorkspaceRoot(payload, filePath) {
  const roots = payload.workspace_roots ?? [];
  if (roots.length === 0) {
    return path.dirname(filePath);
  }
  const sorted = [...roots].sort((a, b) => b.length - a.length);
  for (const root of sorted) {
    if (filePath === root || filePath.startsWith(root + path.sep)) {
      return root;
    }
  }
  return sorted[0];
}

function toRelative(filePath, root) {
  const rel = path.relative(root, filePath);
  return rel.split(path.sep).join("/");
}

function countFileLines(filePath) {
  try {
    if (!fs.existsSync(filePath)) return 0;
    const content = fs.readFileSync(filePath, "utf8");
    if (content.length === 0) return 0;
    return countLines(content);
  } catch {
    return 0;
  }
}

function main() {
  readStdin()
    .then((payload) => {
      if (!payload?.file_path) {
        process.exit(0);
        return;
      }

      const filePath = path.resolve(payload.file_path);
      const workspaceRoot = resolveWorkspaceRoot(payload, filePath);
      const relativeFile = toRelative(filePath, workspaceRoot);
      const kagentDir = path.join(workspaceRoot, ".kagent");
      const config = loadConfig(kagentDir);

      if (isIgnored(relativeFile, config)) {
        process.exit(0);
        return;
      }

      const edits = payload.edits ?? [];
      const linesAfter = countFileLines(filePath);

      const symbolsPath = path.join(kagentDir, "symbols.json");
      const symbolsDoc = loadJson(symbolsPath, { symbols: {} });
      const existing = symbolsDoc.symbols[relativeFile];
      const isIpo = !existing;

      let linesBefore;
      if (existing && typeof existing.last_lines === "number") {
        linesBefore = existing.last_lines;
      } else {
        const preStats = computeEditStats(edits);
        linesBefore =
          preStats.net !== 0
            ? Math.max(0, linesAfter - preStats.net)
            : linesAfter;
      }

      const stats = reconcileStatsWithFile(
        computeEditStats(edits),
        linesBefore,
        linesAfter
      );

      const editCount = (existing?.edit_count ?? 0) + 1;
      const ts = Date.now();
      const { high: simHigh, low: simLow } = simulateRoundExtremes(
        linesBefore,
        edits
      );
      const lines_high = Math.max(simHigh, linesBefore, linesAfter);
      const lines_low = Math.min(simLow, linesBefore, linesAfter);

      const event = {
        v: 2,
        ts,
        conversation_id: payload.conversation_id ?? null,
        generation_id: payload.generation_id ?? null,
        file: relativeFile,
        added: stats.added,
        removed: stats.removed,
        net: stats.net,
        lines_before: linesBefore,
        lines_after: linesAfter,
        lines_high,
        lines_low,
        is_ipo: isIpo,
        edit_index: editCount,
        source: payload.hook_event_name ?? "afterFileEdit",
      };

      appendNdjson(path.join(kagentDir, "events.ndjson"), event);

      symbolsDoc.symbols[relativeFile] = {
        ipo_ts: existing?.ipo_ts ?? ts,
        edit_count: editCount,
        last_lines: linesAfter,
        last_ts: ts,
        delisted: false,
      };
      saveJson(symbolsPath, symbolsDoc);

      process.exit(0);
    })
    .catch((err) => {
      console.error("[kagent-capture]", err.message);
      process.exit(0);
    });
}

main();
