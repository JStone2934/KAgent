import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

const HOOKS_JSON = `{
  "version": 1,
  "hooks": {
    "afterFileEdit": [
      {
        "command": "node .cursor/hooks/kagent-capture.mjs"
      }
    ]
  }
}
`;

export async function installProjectHooks(
  extensionUri: vscode.Uri
): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    vscode.window.showErrorMessage("KAgent: 请先打开一个工作区文件夹。");
    return;
  }

  const root = folders[0].uri.fsPath;
  const cursorDir = path.join(root, ".cursor");
  const hooksDir = path.join(cursorDir, "hooks");
  const hooksJsonPath = path.join(cursorDir, "hooks.json");
  const captureDest = path.join(hooksDir, "kagent-capture.mjs");
  const recordDest = path.join(hooksDir, "kagent-record.mjs");
  const captureSrc = path.join(
    extensionUri.fsPath,
    "resources",
    "kagent-capture.mjs"
  );
  const recordSrc = path.join(
    extensionUri.fsPath,
    "resources",
    "kagent-record.mjs"
  );

  fs.mkdirSync(hooksDir, { recursive: true });

  if (!fs.existsSync(captureSrc) || !fs.existsSync(recordSrc)) {
    vscode.window.showErrorMessage(
      "KAgent: 找不到内置 hook 脚本，请重新安装扩展。"
    );
    return;
  }

  fs.copyFileSync(captureSrc, captureDest);
  fs.copyFileSync(recordSrc, recordDest);
  fs.chmodSync(captureDest, 0o755);
  fs.chmodSync(recordDest, 0o755);

  if (fs.existsSync(hooksJsonPath)) {
    const merge = await vscode.window.showWarningMessage(
      "已存在 .cursor/hooks.json，是否覆盖为 KAgent 配置？",
      "覆盖",
      "取消"
    );
    if (merge !== "覆盖") {
      vscode.window.showInformationMessage(
        "已复制 kagent-capture.mjs，请手动在 hooks.json 中注册 afterFileEdit。"
      );
      return;
    }
  }

  fs.writeFileSync(hooksJsonPath, HOOKS_JSON, "utf8");

  const kagentDir = path.join(root, ".kagent");
  if (!fs.existsSync(kagentDir)) {
    fs.mkdirSync(kagentDir, { recursive: true });
    fs.writeFileSync(
      path.join(kagentDir, "config.json"),
      JSON.stringify(
        {
          ignoreGlobs: [
            "**/node_modules/**",
            "**/.git/**",
            "**/.kagent/**",
            "**/dist/**",
            "**/out/**",
          ],
          capture: {
            onSave: true,
            agentHook: true,
            coalesceWindowMs: 1500,
          },
        },
        null,
        2
      ) + "\n",
      "utf8"
    );
  }

  const gitignorePath = path.join(root, ".gitignore");
  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, "utf8");
    if (!content.includes(".kagent/")) {
      fs.appendFileSync(gitignorePath, "\n.kagent/\n", "utf8");
    }
  } else {
    fs.writeFileSync(gitignorePath, ".kagent/\n", "utf8");
  }

  vscode.window.showInformationMessage(
    "KAgent: 项目 Hooks 已安装。保存文件或 Agent 修改均可产生行情。"
  );
}

export function hooksConfigured(workspaceRoot: string): boolean {
  const hooksJsonPath = path.join(workspaceRoot, ".cursor", "hooks.json");
  if (!fs.existsSync(hooksJsonPath)) {
    return false;
  }
  try {
    const doc = JSON.parse(fs.readFileSync(hooksJsonPath, "utf8")) as {
      hooks?: { afterFileEdit?: unknown[] };
    };
    const list = doc.hooks?.afterFileEdit;
    return Array.isArray(list) && list.length > 0;
  } catch {
    return false;
  }
}
