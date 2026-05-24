import * as vscode from "vscode";
import { MarketViewProvider } from "./marketViewProvider";
import { installProjectHooks, hooksConfigured } from "./hookInstaller";

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

  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (root && !hooksConfigured(root)) {
    void vscode.window
      .showInformationMessage(
        "KAgent: 尚未配置项目 Hooks，Agent 修改将无法记录行情。",
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
