import * as path from "path";
import * as vscode from "vscode";

export function getKagentDir(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    return undefined;
  }
  return path.join(folders[0].uri.fsPath, ".kagent");
}

export function getEventsPath(kagentDir: string): string {
  return path.join(kagentDir, "events.ndjson");
}

export function getSymbolsPath(kagentDir: string): string {
  return path.join(kagentDir, "symbols.json");
}
