import * as vscode from "vscode";
import { isMarketColorConfigChange } from "./colorScheme";
import { MarketViewProvider } from "./marketViewProvider";
import { hooksConfigured, installProjectHooks } from "./hookInstaller";
import { isCaptureOnSaveEnabled } from "./kagentConfig";
import { getKagentDir } from "./paths";
import { registerSaveCapture } from "./saveCapture";

let marketProvider: MarketViewProvider | undefined;

export function activate(context: vscode.ExtensionContext): void {
  marketProvider = new MarketViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      MarketViewProvider.viewType,
      marketProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("kagent.openChart", () => {
      void vscode.commands.executeCommand(
        "workbench.view.extension.kagent"
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("kagent.installHooks", () => {
      void installProjectHooks(context.extensionUri);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("kagent.refresh", () => {
      void marketProvider?.refresh();
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (isMarketColorConfigChange(e)) {
        void marketProvider?.refresh();
      }
    })
  );

  registerSaveCapture(context);

  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const kagentDir = getKagentDir();
  const onSave = isCaptureOnSaveEnabled(kagentDir);
  const hooks = root ? hooksConfigured(root) : false;

  if (root && onSave && !hooks) {
    void vscode.window
      .showInformationMessage(
        "KAgent: 已记录保存时的手动编辑。安装 Hooks 可同时记录 Agent 修改。",
        "安装 Hooks"
      )
      .then((choice) => {
        if (choice === "安装 Hooks") {
          void installProjectHooks(context.extensionUri);
        }
      });
  } else if (root && !onSave && !hooks) {
    void vscode.window
      .showInformationMessage(
        "KAgent: 保存采集已关闭，且未配置 Hooks。请在设置中开启 kagent.capture.onSave 或安装 Hooks。",
        "安装 Hooks"
      )
      .then((choice) => {
        if (choice === "安装 Hooks") {
          void installProjectHooks(context.extensionUri);
        }
      });
  }

  context.subscriptions.push({
    dispose: () => marketProvider?.disposeWatchers(),
  });
}

export function deactivate(): void {
  marketProvider?.disposeWatchers();
}
