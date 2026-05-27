#!/usr/bin/env node
/**
 * 模拟扩展 onSave 采集（不经过 VS Code）。
 * 用法: node scripts/simulate-save.mjs <相对路径>
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { recordFileChange } from "../extension/resources/kagent-record.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rel = process.argv[2] || "demo/sample.txt";
const abs = path.join(root, rel);

if (!fs.existsSync(abs)) {
  console.error(`File not found: ${rel}`);
  process.exit(1);
}

const before = fs.readFileSync(abs, "utf8");
const marker = `\n// save-sim ${Date.now()}\n`;
fs.writeFileSync(abs, before + marker, "utf8");
const after = fs.readFileSync(abs, "utf8");

function countLines(text) {
  if (!text) return 0;
  const parts = text.split("\n");
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts.length;
}

const result = recordFileChange({
  workspaceRoot: root,
  relativeFile: rel.replace(/\\/g, "/"),
  linesAfter: countLines(after),
  oldText: before,
  source: "onSave",
  actor: "human",
  save_reason: "manual",
  editor: "simulate",
});

if (!result.recorded) {
  console.log(`No event (${result.reason ?? "skipped"})`);
} else {
  console.log(`Recorded save for ${rel} → edit #${result.event?.edit_index}`);
}
