import * as vscode from "vscode";

/** 用 VS Code 工作区 API 判断相对路径文件是否存在（比裸 fs 更可靠） */
export async function isFileMissingInWorkspace(
  folder: vscode.WorkspaceFolder,
  relativeFile: string
): Promise<boolean> {
  const uri = vscode.Uri.joinPath(folder.uri, relativeFile);
  try {
    await vscode.workspace.fs.stat(uri);
    return false;
  } catch {
    return true;
  }
}
