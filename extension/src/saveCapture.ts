import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { readSymbols } from "./eventStore";
import { ensureKagentConfig, isCaptureOnSaveEnabled } from "./kagentConfig";
import { countLines } from "./lineStats";
import { recordFileChange } from "./recordChange";

/** 上次记入行情后的文件内容（用于保存前后 diff，勿用打开时的编辑器内容初始化） */
const lastRecordedContent = new Map<string, string>();
const pendingSaveReason = new Map<string, string>();

export function primeSnapshot(relativeFile: string, content: string): void {
  lastRecordedContent.set(relativeFile, content);
}

function readDiskText(workspaceRoot: string, relativeFile: string): string {
  try {
    const abs = path.join(workspaceRoot, relativeFile);
    if (fs.existsSync(abs)) {
      return fs.readFileSync(abs, "utf8");
    }
  } catch {
    /* ignore */
  }
  return "";
}

/** 若该文件已有行情，用磁盘内容作为 diff 基准（= 上次保存态） */
function primeSnapshotFromDiskIfTracked(
  workspaceRoot: string,
  relativeFile: string
): void {
  const kagentDir = path.join(workspaceRoot, ".kagent");
  const symbols = readSymbols(kagentDir);
  if (!symbols.symbols[relativeFile]) {
    return;
  }
  lastRecordedContent.set(relativeFile, readDiskText(workspaceRoot, relativeFile));
}

function saveReasonLabel(reason: vscode.TextDocumentSaveReason): string {
  switch (reason) {
    case vscode.TextDocumentSaveReason.Manual:
      return "manual";
    case vscode.TextDocumentSaveReason.AfterDelay:
      return "auto";
    case vscode.TextDocumentSaveReason.FocusOut:
      return "focus";
    default:
      return "unknown";
  }
}

function relativePath(
  doc: vscode.TextDocument,
  workspaceRoot: string
): string | null {
  if (doc.isUntitled || doc.uri.scheme !== "file") {
    return null;
  }
  const rel = path.relative(workspaceRoot, doc.uri.fsPath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return null;
  }
  return rel.split(path.sep).join("/");
}

function editorId(): string {
  return vscode.env.appName.toLowerCase().includes("cursor") ? "cursor" : "vscode";
}

export function bootstrapSaveSnapshots(workspaceRoot: string): void {
  const kagentDir = path.join(workspaceRoot, ".kagent");
  if (!fs.existsSync(kagentDir)) {
    return;
  }
  const symbols = readSymbols(kagentDir);
  for (const relativeFile of Object.keys(symbols.symbols)) {
    primeSnapshot(relativeFile, readDiskText(workspaceRoot, relativeFile));
  }
  for (const doc of vscode.workspace.textDocuments) {
    const rel = relativePath(doc, workspaceRoot);
    if (rel) {
      primeSnapshotFromDiskIfTracked(workspaceRoot, rel);
    }
  }
}

export function registerSaveCapture(context: vscode.ExtensionContext): void {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (root) {
    bootstrapSaveSnapshots(root);
  }

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!wsRoot) {
        return;
      }
      const rel = relativePath(doc, wsRoot);
      if (!rel) {
        return;
      }
      primeSnapshotFromDiskIfTracked(wsRoot, rel);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onWillSaveTextDocument((e) => {
      const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!wsRoot) {
        return;
      }
      const rel = relativePath(e.document, wsRoot);
      if (rel) {
        pendingSaveReason.set(rel, saveReasonLabel(e.reason));
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      void handleSave(doc);
    })
  );
}

async function handleSave(doc: vscode.TextDocument): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return;
  }
  const workspaceRoot = folder.uri.fsPath;
  const kagentDir = path.join(workspaceRoot, ".kagent");

  if (!isCaptureOnSaveEnabled(kagentDir)) {
    return;
  }

  const rel = relativePath(doc, workspaceRoot);
  if (!rel) {
    return;
  }

  ensureKagentConfig(kagentDir);

  const newText = doc.getText();
  const linesAfter = countLines(newText);
  let oldText = lastRecordedContent.get(rel);
  if (oldText === undefined) {
    oldText = "";
  }
  const saveReason = pendingSaveReason.get(rel) ?? "unknown";
  pendingSaveReason.delete(rel);

  const result = recordFileChange({
    workspaceRoot,
    relativeFile: rel,
    linesAfter,
    oldText,
    source: "onSave",
    actor: "human",
    save_reason: saveReason,
    editor: editorId(),
  });

  if (result.recorded) {
    lastRecordedContent.set(rel, newText);
  } else if (result.reason === "coalesced" || result.reason === "unchanged") {
    lastRecordedContent.set(rel, newText);
  }
}
