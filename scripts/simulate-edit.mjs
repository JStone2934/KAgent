#!/usr/bin/env node
/**
 * 模拟 afterFileEdit，用于本地测试 KAgent hook。
 * 用法: node scripts/simulate-edit.mjs <相对路径> [追加行数]
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rel = process.argv[2] || "demo/sample.txt";
const addLines = Number(process.argv[3] ?? 3);
const abs = path.join(root, rel);

fs.mkdirSync(path.dirname(abs), { recursive: true });
const before = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "";
const chunk = Array.from({ length: addLines }, (_, i) => `line-${Date.now()}-${i}`).join("\n") + "\n";
const after = before + chunk;
fs.writeFileSync(abs, after, "utf8");

const payload = {
  file_path: abs,
  edits: [{ old_string: before, new_string: after }],
  hook_event_name: "afterFileEdit",
  workspace_roots: [root],
};

const hook = path.join(root, ".cursor/hooks/kagent-capture.mjs");
const result = spawnSync("node", [hook], {
  input: JSON.stringify(payload),
  encoding: "utf8",
});

if (result.status !== 0) {
  console.error(result.stderr || result.stdout);
  process.exit(1);
}
console.log(`Recorded edit for ${rel} (+${addLines} lines)`);
