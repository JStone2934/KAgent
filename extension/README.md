# KAgent

<p align="center">
  <a href="https://github.com/JStone2934/KAgent/blob/main/README.md">中文文档</a> ·
  <a href="https://github.com/JStone2934/KAgent/blob/main/README.en.md">English</a> ·
  <a href="https://open-vsx.org/extension/JStone/kagent">Open VSX</a>
</p>

将 Cursor Agent 的每次文件修改画成「股票」K 线：一个文件一支股票，首次被改即上市，每次编辑一根 K 线。

Visualize Cursor Agent file edits as stock-style candlesticks: one file per ticker, first edit as IPO, each edit round as one candle.

## 功能 · Features

- 通过 [Cursor Hooks](https://cursor.com/docs/hooks) `afterFileEdit` 自动采集 / Auto-capture via `afterFileEdit`
- 活动栏 **KAgent** 侧边栏：列表 + K 线 + 成交量 / Sidebar list, chart, and volume
- A 股 / 美股配色、亮 / 暗主题 / CN & US color schemes, light & dark tones
- 离线内置图表 / Offline bundled chart

## 快速开始 · Quick start

1. 安装扩展后，用 Cursor **打开仓库根目录**（工作区 **Trusted**）  
   After install, open the **repo root** in Cursor (workspace **Trusted**).
2. 命令面板 → **`KAgent: 安装项目 Hooks`**
3. 活动栏 **KAgent** 查看行情 / Open **KAgent** in the activity bar

## 设置 · Settings

| Key | 说明 / Description |
|-----|-------------------|
| `kagent.colorScheme` | `cn` 红涨绿跌 · `us` green up / red down |
| `kagent.colorTone` | `light` · `dark` |

## 完整文档 · Full docs

[github.com/JStone2934/KAgent](https://github.com/JStone2934/KAgent)

## 许可证 · License

MIT
