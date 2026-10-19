# dsh-plugin-easyeda-agent

嘉立创 EDA 专业版（EasyEDA Pro）自动化插件：给 DeepSeek Harness 的 Agent 装上「画板的**手** + 工艺/绘制规则的**脑**」。
参考 [easyeda-agent](https://github.com/zhoushoujianwork/easyeda-agent) 的架构，但实现为一个 **DSH 原生 Host 插件**（直接注册工具与技能，无需 MCP 中转），并新增一等公民的**知识层**（工艺参数/绘制原则）。

## 架构（自下而上分层）

```
skill/SKILL.md           教 agent 全流程怎么走（需求→建库→原理图→布局→布线→检查）
lib/tools.js            工具层：easyeda_health/knowledge/apply/gate/actions/call/blocks/project_transfer/docs（workflow 已弃用）
lib/knowledge.js        知识层：读 knowledge/*.md + 实时拉官方文档
lib/actions.js          动作层：类型化动作目录 + 路由守卫 + 参数组装
lib/transport.js        传输层：复用 `easyeda` CLI（Go daemon + EDA Agent Connector）
knowledge/*.md          工艺参数(PROCESS) / 绘制原则(DRAWING_PRINCIPLES) / 官方文档索引(OFFICIAL_DOCS)
```

- **transport.js** 是唯一与 EasyEDA 后端打交道的地方，换后端只改这一层。
- **actions.js** 把「动作目录 + 写前守卫」收敛到一起，保证写操作必须显式绑定 project/doc。
- **knowledge/** 是相对参考实现的增量：agent 绘制过程中随时查工艺参数与绘制原则，并可用 `easyeda_docs` 拉官方文档核对。

## 前置依赖

本插件复用 `easyeda` CLI 作为后端（即参考项目的 Go CLI/daemon + EDA Agent Connector）：

1. 安装 `easyeda` CLI 并 `easyeda daemon start`；
2. 在 EasyEDA Pro 安装 **EDA Agent Connector** 扩展并开启「设置 → 允许外部交互」；
3. `easyeda health` 能列出已连窗口即就绪。

若你的 CLI 不在 PATH，配置里指定 `easyedaBin` 或用环境变量 `EASYEDA_BIN`。

## 安装

### 方式一：clone 后按目录安装（推荐，最稳）

```bash
git clone https://github.com/new-233/easyeda-agent.git
```

然后在 DSH 里：

```text
plugin_manager install_bundle target=<克隆出来的 easyeda-agent 目录绝对路径>
```

### 方式二：直接按 GitHub 包安装

```text
plugin_manager install_bundle target=github:new-233/easyeda-agent#main
```

> ⚠️ 本插件把 `@deepseek-ai/schemastery` vendor 在 `node_modules/` 里（`schemastery` 并不在
> DSH profile 中，所以它必须随包提供）。若你的安装器按 npm 打包语义丢掉了 `node_modules`，
> 插件会**降级运行**：Config 不再生效（`easyedaBin`/`timeoutMs` 用默认值，`EASYEDA_BIN`
> 环境变量仍有效），工具与知识层照常工作。要保留可配置性，请用方式一。

组合包补丁（`cordis.patch.yml`）用**相对路径** `./lib/main.js`（Loader 会把它锚定在 patch
文件所在目录），因此仓库放在哪里都能加载，不绑死本机绝对路径。

改代码后：递增 `lib/main.js` 的 `VERSION`，重新 `install_bundle`，然后**重启 DSH**
（替换已安装的包需要重启才能加载新的模块代）。

## 配置

```yaml
- id: easyeda-agent
  config:
    enabled: true
    easyedaBin: ''        # 留空 = 环境变量 EASYEDA_BIN 或 PATH 上的 easyeda
    timeoutMs: 300000     # CLI 单次调用超时
```

## 迭代路线图（逐步完善，直至全流程自动化）

- [ ] transport：目前复用 `easyeda` CLI；后续可直连 Connector WebSocket 或官方 easyeda-api-sdk，去掉 Go 依赖。
- [x] **actions / 流程：接上两条主力执行通道**
  - `easyeda_apply` —— playbook 回放（`--dry-run` / `--resume` / `--from|--to` / `--var` / `--step-delay`），
    批量写入的首选通道；上游 esp32-mini 样例用它跑完原理图 47 步 + PCB 182 步并逐条对齐金板铜几何。
    确认门（如清页）**默认不会被自动批准**，必须显式传 `yes`。
  - `easyeda_gate` —— 阶段验收门与只读检查，sch 11 条 / pcb 12 条命令，
    旗标按**逐命令白名单 fail-closed**（未登记的键会被拒绝，而不是拼出一条错误命令）。
  - `easyeda_workflow` 已弃用（它包装的 `easyeda workflow` 在 CLI 里已标 Deprecated）。
- [x] **knowledge：`knowledge/flow.md` 全流程 Runbook**
  S0–S6 / P0–P10 逐阶段的主命令、要过的门、要回读什么，外加 10 条实测陷阱
  （铺铜 reflow 规则快照与 `doc reload` workaround、命名 region 被平台拒、长网名撑爆标记、
  `outline-fit` 必须在贴边之后、`auto-place` 跳过边缘连接器…）。**改完即时生效，无需重启。**
- [ ] actions：继续按 `easyeda_actions` 实测结果补类型化动作与入参契约
  （`easyeda_gate` 目前已核对 35 个旗标 / 23 条命令；`pcb layout-plan`、`pcb layout solve`、
  `pcb dump`、`pcb route` 等**离线规划与求解**命令还没有 typed 封装）。
- [ ] 建库/丝印/阻抗等专项：按需补 skill 流程与动作。
- [x] 自检：`scripts/selfcheck.mjs` 一条命令跑完全部离线 + 真实 CLI 校验（见下）。

## 如何迭代（改哪里、要不要重启）

| 你想改的东西 | 改哪个文件 | 生效方式 |
|---|---|---|
| **你自己的项目规则**（线宽/封装/禁止项/验收标准） | `knowledge/rules.md` | **改完立即生效** |
| 工艺参数基线 | `knowledge/process.md` | **改完立即生效** |
| 绘制原则 | `knowledge/drawing.md` | **改完立即生效** |
| 新增一类知识（如"本项目的叠层规范"） | 往 `knowledge/` 丢一个 `.md` | **改完立即生效**（目录自动扫描，主题 id = 文件名小写） |
| Agent 工作流 / 提示词 / 护栏 | `skill/SKILL.md` | 需重启 DSH |
| 新增/修改工具、动作路由、换后端 | `lib/*.js` | 需重启 DSH |
| CLI 路径 / 超时 | profile 的 `cordis.patch.yml` 中 `easyeda-agent` 的 config | 保存即热重载 |

**两种迭代方式：**

1. **你自己改**：改 `knowledge/*.md` 最省事——纯 Markdown、**改完立即生效**，Agent 下次绘制就会读到；想加一类新规则，直接往 `knowledge/` 丢一个新 `.md` 即可（目录自动扫描，无需改代码）。
2. **交给 Agent**：直接说需求或规则，由 Agent 改代码 / 知识文件；涉及 `lib/` 或 `skill/` 时，Agent 会递增 `VERSION` 并重装，然后告知是否需要重启 DSH。

> ⚠️ **只有 `knowledge/*.md` 是真正"免重启热更新"的**。`lib/` 与 `skill/` 的改动需要重启 DSH——
> 这是 DSH 的机制（官方文档：*replacing an installed package requires restart to load a fresh JavaScript module generation*）。

## 目录速查

| 文件 | 作用 |
|---|---|
| `lib/main.js` | 插件入口（Config / apply / 注册工具与技能） |
| `lib/tools.js` | 工具定义（改工具面在这） |
| `lib/actions.js` | 类型化动作与参数组装（改动作路由在这） |
| `lib/transport.js` | easyeda CLI 传输（换后端在这） |
| `lib/knowledge.js` | 知识读取与文档拉取 |
| `knowledge/*.md` | 工艺参数 / 绘制原则 / 官方文档索引（改规则在这） |
| `skill/SKILL.md` | agent 全流程工作流（改流程在这） |

## 自检（改完代码先跑这个）

```powershell
$env:EASYEDA_DIR='<本插件目录>'
$env:EASYEDA_PLAYBOOK='<任意 playbook.json，可选>'
node scripts/selfcheck.mjs
```

| 步骤 | 验什么 |
|---|---|
| `verify.mjs` | 入口/配置/知识主题/工具面能否构建 |
| `runtime-check.mjs` | 每个工具在后端缺失时仍返回**无损 JSON**（DSH 硬要求：不能出现 `undefined`） |
| `flow-selftest.mjs` | `easyeda_apply` / `easyeda_gate` 的 argv **逐字**断言 + 全部守卫必然报错 |
| `gate-flag-audit.mjs` | 白名单里的旗标**确实被真实 CLI 支持**（抓「发明旗标」，单测抓不到） |
| `flow-integration.mjs` | 构造器产出的 argv 真的交给 `easyeda` CLI 跑一遍（需 `EASYEDA_PLAYBOOK`） |

全部通过时打印 `SELFCHECK_OK`。**这些步骤不读写任何 EDA 工程。**

## 维护注意（两个容易踩的坑）

1. **`easyeda skill sync` 不管 `~/.dsh/skills/`。** 它只认 `claude` / `codex` / `agents` 三个客户端目录
   （`easyeda skill --help` 可核对）。而 DSH 实际加载的是 `~/.dsh/skills/easyeda-agent`。
   → **升级 CLI 时这一份必须手工同步**，否则代理读到的流程指引会和 CLI 版本脱节。
2. **本机 `github.com` 不可达**（`api.github.com` / `objects.githubusercontent.com` 可达）。
   `easyeda update` 直接走 `github.com/.../releases/download/...`，因此**必然超时**
   （且它是先下二进制再取 checksums，失败时不会破坏已安装的二进制）。
   绕法：走 `api.github.com/repos/<owner>/<repo>/releases/assets/<id>`
   （带 `Accept: application/octet-stream`，会 302 到可达的 objects 主机），
   下完**必须**用 `checksums.txt` 校验 SHA256 再安装。
