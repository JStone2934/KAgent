import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

/** 包含 .kagent 的工作区根目录（多根工作区时自动匹配） */
export function getKagentWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    return undefined;
  }
  for (const folder of folders) {
    if (fs.existsSync(path.join(folder.uri.fsPath, ".kagent"))) {
      return folder;
    }
  }
  return folders[0];
}

export function getKagentDir(): string | undefined {
  const folder = getKagentWorkspaceFolder();
  if (!folder) {
    return undefined;
  }
  return path.join(folder.uri.fsPath, ".kagent");
}

export function getEventsPath(kagentDir: string): string {
  return path.join(kagentDir, "events.ndjson");
}

export function getSymbolsPath(kagentDir: string): string {
  return path.join(kagentDir, "symbols.json");
}
