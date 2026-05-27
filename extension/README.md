# KAgent

将 Cursor Agent 的每次文件修改画成「股票」K 线：一个文件一支股票，首次被改即上市，每次编辑一根 K 线。

## 功能

- 通过 [Cursor Hooks](https://cursor.com/docs/hooks) 的 `afterFileEdit` 自动采集编辑事件
- 活动栏 **KAgent** 侧边栏：文件列表 + K 线图 + 成交量
- 支持 A 股 / 美股涨跌配色、亮色 / 暗色主题
- 离线内置图表，无需联网

## 快速开始

1. 安装本扩展后，用 Cursor **打开仓库根目录**（工作区需为 **Trusted**）
2. 命令面板执行 **`KAgent: 安装项目 Hooks`**
3. 点击活动栏 **KAgent** 图标查看行情

Agent 每修改一个文件，列表中会新增一支「股票」；选中即可查看 K 线并在编辑器中打开该文件。

## 设置

| 设置项 | 说明 |
|--------|------|
| `kagent.colorScheme` | `cn`（红涨绿跌）或 `us`（绿涨红跌） |
| `kagent.colorTone` | `light` 或 `dark` |

## 仓库与文档

完整说明、架构图与本地演示见 GitHub 仓库：[JStone2934/KAgent](https://github.com/JStone2934/KAgent)

## 许可证

MIT
