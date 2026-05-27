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
import { isCaptureOnSaveEnabled } from "./kagentConfig";
import { getKagentDir, getKagentWorkspaceFolder } from "./paths";
import { DELIST_PURGE_AFTER_MS, syncDelistedSymbols } from "./symbolDelist";
import { isFileMissingInWorkspace } from "./workspaceFiles";
import { syncSnapshotsFromSymbols } from "./snapshotSync";
import { MarketPayload, SymbolsFile } from "./types";

export class MarketViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "kagent.marketView";

  private view?: vscode.WebviewView;
  private selectedFile: string | null = null;
  private watchers: vscode.FileSystemWatcher[] = [];
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private delistPurgeTimer?: ReturnType<typeof setTimeout>;
  private messageDisposable?: vscode.Disposable;
  private readonly extensionVersion: string;

  constructor(private readonly extensionUri: vscode.Uri) {
    this.extensionVersion = readExtensionVersion(extensionUri);
  }

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

    this.messageDisposable?.dispose();
    this.messageDisposable = webviewView.webview.onDidReceiveMessage((msg) => {
      if (msg.type === "selectSymbol") {
        this.selectedFile = msg.file ?? null;
        void this.pushUpdate();
        void this.openSelectedFileInEditor(this.selectedFile);
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
    this.setupWorkspaceDeleteWatcher();
    void this.pushUpdate();
  }

  /** 仅释放文件监视器（勿动 webview 消息监听） */
  private disposeFileWatchers(): void {
    for (const w of this.watchers) {
      w.dispose();
    }
    this.watchers = [];
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    if (this.delistPurgeTimer) {
      clearTimeout(this.delistPurgeTimer);
      this.delistPurgeTimer = undefined;
    }
  }

  disposeWatchers(): void {
    this.messageDisposable?.dispose();
    this.messageDisposable = undefined;
    this.disposeFileWatchers();
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
    const folder = getKagentWorkspaceFolder();
    if (!folder || (await isFileMissingInWorkspace(folder, relativeFile))) {
      return;
    }
    const uri = vscode.Uri.joinPath(folder.uri, relativeFile);
    try {
      await vscode.window.showTextDocument(uri, {
        preview: false,
        preserveFocus: false,
      });
    } catch {
      /* 已删除或不可读时不打扰用户 */
    }
  }

  private setupWatchers(): void {
    this.disposeFileWatchers();
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
      this.refreshTimer = setTimeout(() => {
        const folder = getKagentWorkspaceFolder();
        if (folder && kagentDir) {
          syncSnapshotsFromSymbols(kagentDir, folder.uri.fsPath);
        }
        void this.pushUpdate();
      }, 150);
    };
    watcher.onDidChange(schedule);
    watcher.onDidCreate(schedule);
    this.watchers.push(watcher);
  }

  private setupWorkspaceDeleteWatcher(): void {
    const folder = getKagentWorkspaceFolder();
    if (!folder) {
      return;
    }
    const pattern = new vscode.RelativePattern(folder, "**/*");
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    watcher.onDidDelete(() => {
      if (this.refreshTimer) {
        clearTimeout(this.refreshTimer);
      }
      this.refreshTimer = setTimeout(() => void this.pushUpdate(), 150);
    });
    this.watchers.push(watcher);
  }

  private async pushUpdate(): Promise<void> {
    if (!this.view) {
      return;
    }
    try {
      const payload = await this.loadPayload();
      await this.view.webview.postMessage({ type: "marketUpdate", payload });
    } catch (err) {
      console.error("KAgent: 行情刷新失败", err);
    }
  }

  private scheduleDelistPurgeRefresh(symbolsDoc: SymbolsFile): void {
    if (this.delistPurgeTimer) {
      clearTimeout(this.delistPurgeTimer);
      this.delistPurgeTimer = undefined;
    }

    const now = Date.now();
    let nextDelay: number | undefined;
    for (const info of Object.values(symbolsDoc.symbols)) {
      if (!info.delisted) {
        continue;
      }
      const delistedAt = info.delisted_at ?? now;
      const delay = Math.max(
        250,
        delistedAt + DELIST_PURGE_AFTER_MS - now + 50
      );
      nextDelay = Math.min(nextDelay ?? delay, delay);
    }

    if (nextDelay === undefined) {
      return;
    }

    this.delistPurgeTimer = setTimeout(() => {
      this.delistPurgeTimer = undefined;
      void this.pushUpdate();
    }, nextDelay);
  }

  private async loadPayload(): Promise<
    MarketPayload & {
      hooksOk: boolean;
      captureOnSave: boolean;
      captureEnabled: boolean;
      kagentDir: string | null;
      colorScheme: ColorScheme;
      colorTone: ColorTone;
    }
  > {
    const kagentDir = getKagentDir();
    const folder = getKagentWorkspaceFolder();
    const workspaceRoot = folder?.uri.fsPath;

    if (!kagentDir) {
      return {
        symbols: [],
        selectedFile: null,
        candles: {},
        missingFiles: [],
        hooksOk: false,
        captureOnSave: true,
        captureEnabled: true,
        kagentDir: null,
        colorScheme: getColorScheme(),
        colorTone: getColorTone(),
      };
    }

    const events = await readAllEvents(kagentDir);
    let symbolsDoc = readSymbols(kagentDir);
    if (workspaceRoot != null) {
      try {
        symbolsDoc = syncDelistedSymbols(kagentDir, workspaceRoot);
      } catch {
        /* 锁冲突时继续用已读 symbols + 下方 VS Code stat 检测 */
      }
    }
    this.scheduleDelistPurgeRefresh(symbolsDoc);
    const market = buildMarketPayload(
      events,
      symbolsDoc,
      this.selectedFile,
      workspaceRoot ?? undefined
    );

    const missingFiles: string[] = [];
    if (folder) {
      for (const s of market.symbols) {
        if (await isFileMissingInWorkspace(folder, s.file)) {
          s.is_delisted = true;
          missingFiles.push(s.file);
        }
      }
    }

    const hooksOk = workspaceRoot
      ? fs.existsSync(path.join(workspaceRoot, ".cursor", "hooks.json"))
      : false;
    const captureOnSave = isCaptureOnSaveEnabled(kagentDir);

    return {
      ...market,
      missingFiles,
      hooksOk,
      captureOnSave,
      captureEnabled: hooksOk || captureOnSave,
      kagentDir,
      colorScheme: getColorScheme(),
      colorTone: getColorTone(),
    };
  }

  private getHtml(webview: vscode.Webview): string {
    const v = this.extensionVersion;
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
  <link rel="stylesheet" href="${styleUri}?v=${v}" />
</head>
<body data-color-scheme="cn" data-color-tone="light" data-kagent-version="${v}">
  <div id="banner" class="banner hidden"></div>
  <div class="layout">
    <aside class="sidebar">
      <div class="sidebar-header">
        <span>全仓库股票</span>
        <span id="symbol-count" class="muted">0</span>
      </div>
      <ul id="symbol-list" class="symbol-list"></ul>
      <p id="empty-hint" class="empty-hint">暂无股票。保存文件或 Agent 修改后会出现。</p>
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
  <script src="${chartLibUri}?v=${v}"></script>
  <script src="${scriptUri}?v=${v}"></script>
</body>
</html>`;
  }
}

function readExtensionVersion(extensionUri: vscode.Uri): string {
  try {
    const pkgPath = path.join(extensionUri.fsPath, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { version?: string };
    return pkg.version ?? "0";
  } catch {
    return "0";
  }
}
