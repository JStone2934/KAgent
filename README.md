# KAgent

将 Cursor Agent 对文件的修改可视化为「股票 K 线」：**一个文件 = 一支股票**，首次被 Agent 修改时上市，后续每次修改增加一根 K 线（开高低收 = 修改前后行数）。

## 架构

- **采集**：项目级 [Cursor Hooks](https://cursor.com/docs/hooks)（`afterFileEdit`）→ `.kagent/events.ndjson` + `symbols.json`
- **展示**：VS Code / Cursor 扩展侧边栏 Webview（lightweight-charts）

## 快速开始

### 1. 安装扩展（开发模式）

```bash
cd extension
npm install
npm run compile
```

在 Cursor 中：**扩展 → 从 VSIX 安装** 或 **F5** 打开 `extension` 文件夹进行调试（Launch: Extension Development Host）。

### 2. 配置项目 Hooks

在仓库根目录（本仓库已包含示例）：

```bash
# 若使用扩展命令，也可：命令面板 →「KAgent: 安装项目 Hooks」
```

确认存在：

- `.cursor/hooks.json`
- `.cursor/hooks/kagent-capture.mjs`

工作区需为 **受信任（Trusted）**，Hooks 才会执行。

### 3. 查看行情

- 活动栏 **KAgent** 图标 → **全仓库行情**
- 或命令：`KAgent: 打开行情图`

Agent 每修改一个新文件，左侧列表出现新股票；选中后右侧显示该文件的 K 线，并在编辑器中打开该文件源码（兼作简易文件导航）。

## 数据目录 `.kagent/`

| 文件 | 说明 |
|------|------|
| `events.ndjson` | 每次编辑一条事件 |
| `symbols.json` | 已上市文件 registry |
| `config.json` | 忽略路径 glob（默认排除 node_modules 等） |

建议加入 `.gitignore`（安装 Hooks 时会自动追加）。

## K 线含义

| 字段 | 含义 |
|------|------|
| Open / Close | 本次修改前 / 后文件行数（蜡烛实体） |
| High / Low | 该轮修改过程中触及的最高 / 最低行数（上/下影线） |
| Volume | 本次增加行数 + 删除行数（底部柱） |
| 颜色 | 收盘 ≥ 开盘为阳线（行数未减少） |

图表库已内置在扩展 `media/lightweight-charts.js`，无需联网。

## 手动测试 Hook

```bash
node scripts/simulate-edit.mjs demo/sample.txt 3
node scripts/simulate-edit.mjs demo/sample.txt 1   # 同一文件第二次修改 → 多一根 K 线
```

然后查看 `.kagent/events.ndjson` 与扩展侧边栏。

## 调试扩展

1. 用 Cursor **打开仓库根目录** `/path/to/KAgent`（确保 `.cursor/hooks.json` 生效）
2. 另开窗口：`extension` 目录 → F5 **Run Extension**
3. 在 Extension Development Host 中打开同一仓库根目录

## 许可证

MIT
