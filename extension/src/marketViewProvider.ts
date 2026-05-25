import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  ColorScheme,
  ColorTone,
  getColorScheme,
  getColorTone,
  setColorScheme,
  setColorTone,
} from "./colorScheme";
import { buildMarketPayload } from "./candleBuilder";
import { readAllEvents, readSymbols } from "./eventStore";
import { getKagentDir } from "./paths";
import { MarketPayload } from "./types";

export class MarketViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "kagent.marketView";

  private view?: vscode.WebviewView;
  private selectedFile: string | null = null;
  private watchers: vscode.FileSystemWatcher[] = [];
  private refreshTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, "media"),
      ],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((msg) => {
      if (msg.type === "selectSymbol") {
        this.selectedFile = msg.file ?? null;
        void this.openSelectedFileInEditor(this.selectedFile);
        void this.pushUpdate();
      }
      if (msg.type === "ready") {
        void this.pushUpdate();
      }
      if (msg.type === "setColorScheme") {
        const scheme: ColorScheme = msg.scheme === "us" ? "us" : "cn";
        void setColorScheme(scheme).then(() => this.pushUpdate());
      }
      if (msg.type === "setColorTone") {
        const tone: ColorTone = msg.tone === "dark" ? "dark" : "light";
        void setColorTone(tone).then(() => this.pushUpdate());
      }
    });

    this.setupWatchers();
    void this.pushUpdate();
  }

  disposeWatchers(): void {
    for (const w of this.watchers) {
      w.dispose();
    }
    this.watchers = [];
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
  }

  async refresh(): Promise<void> {
    await this.pushUpdate();
  }

  /** 选中股票时在编辑器中打开对应源码（相对工作区路径）。 */
  private async openSelectedFileInEditor(
    relativeFile: string | null
  ): Promise<void> {
    if (!relativeFile) {
      return;
    }
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return;
    }
    const uri = vscode.Uri.joinPath(folder.uri, relativeFile);
    try {
      await vscode.window.showTextDocument(uri, {
        preview: false,
        preserveFocus: false,
      });
    } catch {
      void vscode.window.showWarningMessage(
        `KAgent: 无法打开文件 ${relativeFile}（可能已删除或不在工作区内）`
      );
    }
  }

  private setupWatchers(): void {
    this.disposeWatchers();
    const kagentDir = getKagentDir();
    if (!kagentDir) {
      return;
    }
    const pattern = new vscode.RelativePattern(
      vscode.Uri.file(kagentDir),
      "*"
    );
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const schedule = () => {
      if (this.refreshTimer) {
        clearTimeout(this.refreshTimer);
      }
      this.refreshTimer = setTimeout(() => void this.pushUpdate(), 150);
    };
    watcher.onDidChange(schedule);
    watcher.onDidCreate(schedule);
    this.watchers.push(watcher);
  }

  private async pushUpdate(): Promise<void> {
    if (!this.view) {
      return;
    }
    const payload = await this.loadPayload();
    await this.view.webview.postMessage({ type: "marketUpdate", payload });
  }

  private async loadPayload(): Promise<
    MarketPayload & {
      hooksOk: boolean;
      kagentDir: string | null;
      colorScheme: ColorScheme;
      colorTone: ColorTone;
    }
  > {
    const kagentDir = getKagentDir();
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    if (!kagentDir) {
      return {
        symbols: [],
        selectedFile: null,
        candles: {},
        hooksOk: false,
        kagentDir: null,
        colorScheme: getColorScheme(),
        colorTone: getColorTone(),
      };
    }

    const events = await readAllEvents(kagentDir);
    const symbolsDoc = readSymbols(kagentDir);
    const market = buildMarketPayload(
      events,
      symbolsDoc,
      this.selectedFile
    );

    const hooksOk = workspaceRoot
      ? fs.existsSync(path.join(workspaceRoot, ".cursor", "hooks.json"))
      : false;

    return {
      ...market,
      hooksOk,
      kagentDir,
      colorScheme: getColorScheme(),
      colorTone: getColorTone(),
    };
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "market.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "market.css")
    );
    const chartLibUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "lightweight-charts.js")
    );
    const csp = webview.cspSource;

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${csp} 'unsafe-inline'; script-src ${csp} 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
</head>
<body data-color-scheme="cn" data-color-tone="light">
  <div id="banner" class="banner hidden"></div>
  <div class="layout">
    <aside class="sidebar">
      <div class="sidebar-header">
        <span>全仓库股票</span>
        <span id="symbol-count" class="muted">0</span>
      </div>
      <ul id="symbol-list" class="symbol-list"></ul>
      <p id="empty-hint" class="empty-hint">暂无股票。Agent 修改文件后会出现。</p>
    </aside>
    <main class="chart-panel">
      <div class="chart-header">
        <div id="chart-title" class="chart-title">选择一只股票</div>
        <div class="chart-toolbar">
          <div class="scheme-switch" role="group" aria-label="市场配色">
            <button type="button" class="scheme-btn" data-scheme="cn" title="红涨绿跌">A股</button>
            <button type="button" class="scheme-btn" data-scheme="us" title="绿涨红跌">美股</button>
          </div>
          <div class="scheme-switch tone-switch" role="group" aria-label="明暗色调">
            <button type="button" class="scheme-btn" data-tone="light" title="亮色色号">亮</button>
            <button type="button" class="scheme-btn" data-tone="dark" title="暗色色号">暗</button>
          </div>
        </div>
      </div>
      <div id="chart-legend" class="chart-legend muted">开/收=阶段起止行数；同轮先删后增拆为两根K线</div>
      <div id="ohlc-bar" class="ohlc-bar">
        <span class="ohlc-item"><em>轮次</em><strong id="ohlc-round">—</strong></span>
        <span class="ohlc-item"><em>开</em><strong id="ohlc-open">—</strong></span>
        <span class="ohlc-item"><em>高</em><strong id="ohlc-high">—</strong></span>
        <span class="ohlc-item"><em>低</em><strong id="ohlc-low">—</strong></span>
        <span class="ohlc-item"><em>收</em><strong id="ohlc-close">—</strong></span>
        <span class="ohlc-item"><em>量</em><strong id="ohlc-volume">—</strong></span>
      </div>
      <div id="chart-error" class="chart-error hidden"></div>
      <div id="chart-container"></div>
    </main>
  </div>
  <script src="${chartLibUri}"></script>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}
