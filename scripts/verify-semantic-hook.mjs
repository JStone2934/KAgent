#!/usr/bin/env node
/**
 * 验证语义波动 Hook：行数不变、内容变化 → added/removed 同计，K 线先跌后涨。
 * 用法: node scripts/verify-semantic-hook.mjs [相对路径]
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rel = process.argv[2] ?? "demo/watch-me.md";
const abs = path.join(root, rel);
const hook = path.join(root, ".cursor/hooks/kagent-capture.mjs");
const eventsPath = path.join(root, ".kagent/events.ndjson");

if (!fs.existsSync(abs)) {
  console.error("文件不存在:", rel);
  process.exit(1);
}

const before = fs.readFileSync(abs, "utf8");
const lines = before.split("\n");
const idx = lines.findIndex((l) => l.includes("中间行"));
if (idx < 0) {
  console.error("未找到含「中间行」的行，请先在", rel, "中保留测试锚点");
  process.exit(1);
}

const oldLine = lines[idx];
const newLine = oldLine.includes("语义波动")
  ? "中间行将被替换。"
  : "中间行已替换（语义波动 Hook 验证）。";
lines[idx] = newLine;
const after = lines.join("\n");

if (before === after) {
  console.error("前后内容相同，无法验证");
  process.exit(1);
}

fs.writeFileSync(abs, after, "utf8");

const payload = {
  file_path: abs,
  edits: [{ old_string: before, new_string: after }],
  hook_event_name: "afterFileEdit",
  workspace_roots: [root],
};

const result = spawnSync("node", [hook], {
  input: JSON.stringify(payload),
  encoding: "utf8",
});

if (result.status !== 0) {
  fs.writeFileSync(abs, before, "utf8");
  console.error(result.stderr || result.stdout);
  process.exit(1);
}

const lastLine = fs.readFileSync(eventsPath, "utf8").trim().split("\n").pop();
const event = JSON.parse(lastLine);

const ok =
  event.file === rel.replace(/\\/g, "/") &&
  event.added > 0 &&
  event.removed > 0 &&
  event.added === event.removed &&
  event.net === 0 &&
  event.lines_before === event.lines_after &&
  event.lines_low < event.lines_before;

console.log("文件:", rel);
console.log("改写行:", JSON.stringify(oldLine), "→", JSON.stringify(newLine));
console.log("事件:", {
  added: event.added,
  removed: event.removed,
  net: event.net,
  lines_before: event.lines_before,
  lines_after: event.lines_after,
  lines_low: event.lines_low,
  lines_high: event.lines_high,
});
console.log(ok ? "✓ 语义波动采集通过（同轮应拆为先跌后涨两根 K）" : "✗ 未达预期");
process.exit(ok ? 0 : 1);
