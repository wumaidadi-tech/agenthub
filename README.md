# AgentHub

把 Qoder、WorkBuddy、Claude Code、Codex、豆包 的记忆、技能、会话和 MCP 放进一个本地界面管理，解决"换一个 agent 就要重新交代一遍"的问题。

零依赖（Node 20+，不用装 npm 包），只监听 `127.0.0.1`，写任何 agent 文件前都会备份。

## 能做什么

- **记忆**：在中心库写一张卡片，选择分发到哪几家；各家用各自的原生格式写入（标记块 / 独立文件 / 索引）
- **技能**：从任一家或本地文件夹导入，选择"复制到各家"或"指向同一个目录"（Windows 用 junction）
- **会话**：读取各家的本地转录，跨 agent 按项目看时间线，生成交接摘要或导出 Markdown
- **MCP**：汇总各家的 MCP 配置，开关、新增、在 agent 之间互导

## 支持情况

| Agent | 记忆 | 技能 | 会话 | MCP |
| --- | --- | --- | --- | --- |
| Qoder | `~/.qoder-cn/memory/*.md` + `MEMORY.md` 索引（可写） | `~/.qoder-cn/skills` | `~/.qoder-cn/projects/**/*.jsonl` | `~/.qoder-cn/settings.json`（可写） |
| WorkBuddy | `~/.workbuddy/USER.md` 标记块（可写） | `~/.workbuddy/skills` | `~/.workbuddy/projects/<项目>/<会话>.jsonl` | `~/.workbuddy/connectors/default/mcp.json`（可写） |
| Claude Code | `~/.claude/CLAUDE.md` 标记块（可写） | `~/.claude/skills` | `~/.claude/projects/**/*.jsonl` | `~/.claude.json`（可写） |
| Codex | `~/.codex/AGENTS.md` 标记块（可写） | — | `~/.codex/sessions/rollout-*.jsonl` | `~/.codex/config.toml`（只读） |
| 豆包 | 无本地可写文件（只读） | — | — | — |

会话一律只读，不会修改任何原始转录。

## 快速开始

```bash
git clone https://github.com/<you>/agenthub.git
cd agenthub
node server.mjs
```

打开 http://127.0.0.1:4173 。需要 Node.js 20 或更高版本。

## 数据与环境变量

- AgentHub 自己的数据（记忆卡片、技能库、备份、交接稿）默认在 `~/.agenthub`
- `AGENTHUB_HOME`：换一个数据根目录（测试时有用）
- `PORT`：换端口，默认 `4173`

## 安全与写入方式

- 服务只绑定 `127.0.0.1`，并校验 Host / Origin / `content-type`，防止网页跨站调用本地接口
- 写入前把原文件复制到 `~/.agenthub/backups/<时间戳>/<agent>/`
- 共享记忆写在 `<!-- agenthub:begin -->` / `<!-- agenthub:end -->` 标记块里，只替换块内内容，不动其他文字
- Qoder 的记忆是每条一个 MD 文件（`agenthub-*.md`），删除卡片后同步一次即可清除
- 技能"指向同一个库"用 junction，删链接不会删库里的文件

## 已知限制

- 目前只在 Windows 上实测过；macOS / Linux 的路径逻辑可以跑，但"打开文件夹"依赖 `explorer.exe`，需要另做适配
- Claude Code、Codex、豆包没有安装时，对应页面会显示空数据；适配器路径是标准路径，未在本机验证的格式可能随版本变化
- WorkBuddy 国际版读取 `~/.workbuddy-ai/projects`
- WorkBuddy 早期会话没有记录工作区路径时，项目列显示项目目录编码（如 `C-Users-angel-WorkBuddy-main`）
- 首次打开会话页要解析本地转录，几百 MB 时会转几秒，之后按文件修改时间缓存

## 目录结构

```
server.mjs         HTTP 服务与路由
lib/agents.mjs     agent 定义、记忆写入、技能安装
lib/sessions.mjs   各家会话解析、交接与导出
lib/mcp.mjs        MCP 配置读写
lib/import.mjs     导入候选与导入
lib/store.mjs      数据目录、原子写、备份
lib/config.mjs     各 agent 的开关偏好
web/               前端（原生 HTML/CSS/JS）
```