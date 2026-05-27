#!/usr/bin/env node
/**
 * KAgent capture hook — Cursor afterFileEdit → .kagent/
 */
import path from "node:path";
import { recordFromHookPayload } from "./kagent-record.mjs";

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return null;
  return JSON.parse(raw);
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

readStdin()
  .then((payload) => {
    if (!payload?.file_path) {
      process.exit(0);
      return;
    }
    const filePath = path.resolve(payload.file_path);
    const workspaceRoot = resolveWorkspaceRoot(payload, filePath);
    const relativeFile = toRelative(filePath, workspaceRoot);
    recordFromHookPayload(payload, workspaceRoot, relativeFile);
    process.exit(0);
  })
  .catch((err) => {
    console.error("[kagent-capture]", err.message);
    process.exit(0);
  });
