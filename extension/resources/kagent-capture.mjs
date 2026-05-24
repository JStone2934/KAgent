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
  const parts = text.split("\n");
  if (parts.length > 0 && parts[parts.length - 1] === "") {
    parts.pop();
  }
  return parts.length;
}

function computeEditStats(edits) {
  let added = 0;
  let removed = 0;
  for (const edit of edits ?? []) {
    const oldLen = countLines(edit.old_string ?? "");
    const newLen = countLines(edit.new_string ?? "");
    if (newLen > oldLen) {
      added += newLen - oldLen;
    } else {
      removed += oldLen - newLen;
    }
  }
  return { added, removed, net: added - removed };
}

function simulateRoundExtremes(linesBefore, edits) {
  let current = linesBefore;
  let high = current;
  let low = current;
  for (const edit of edits ?? []) {
    const oldLen = countLines(edit.old_string ?? "");
    const newLen = countLines(edit.new_string ?? "");
    const delta = newLen - oldLen;
    current = Math.max(0, current + delta);
    high = Math.max(high, current);
    low = Math.min(low, current);
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
      const stats = computeEditStats(edits);
      const linesAfter = countFileLines(filePath);

      const symbolsPath = path.join(kagentDir, "symbols.json");
      const symbolsDoc = loadJson(symbolsPath, { symbols: {} });
      const existing = symbolsDoc.symbols[relativeFile];
      const isIpo = !existing;

      let linesBefore;
      if (existing && typeof existing.last_lines === "number") {
        linesBefore = existing.last_lines;
      } else if (stats.net !== 0) {
        linesBefore = Math.max(0, linesAfter - stats.net);
      } else {
        linesBefore = linesAfter;
      }

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
