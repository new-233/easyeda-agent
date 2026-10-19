---
name: easyeda-agent
description: 嘉立创 EDA 专业版（EasyEDA Pro）自动化。驱动原理图/PCB 的绘制、修改、建库、布局布线、铺铜、丝印整理与检查，覆盖「需求 → 成品板」全流程。
whenToUse: 当任务要求「画原理图、画/改 PCB、从需求做板、读数据手册建库、整理丝印、标准化器件、检查/修复工程、导出制造文件」等任何需要操作 EasyEDA Pro 的动作时使用。开始前先 easyeda_health 确认连接，先查 easyeda_knowledge(topic:"rules") 读用户自定义规则、再查 topic:"flow" 拿全流程 Runbook；批量写入用 easyeda_apply 回放 playbook，阶段门用 easyeda_gate，单个动作用 easyeda_call，写后回读并跑门。
---

# easyeda-agent 使用指南

嘉立创 EDA 专业版自动化层：Agent 通过一组**类型化工具**驱动官方 `eda.*` API 完成真实读写，
并在写入前后核对器件身份、引脚网络、几何、DRC 与保存状态。
**不要用 GUI 自动化（鼠标/键盘/画布/属性面板/工程树）编辑工程。**

## 规则优先级（重要）

1. **`easyeda_knowledge(topic: "rules")`** —— 用户自定义项目规则（`knowledge/rules.md`），**最高优先级**。
2. **`easyeda_knowledge(topic: "flow")`** —— 全流程 Runbook（阶段阶梯 / 门 / 实测陷阱）。
3. `process`（工艺参数）/ `drawing`（绘制原则）—— 内置基线。
4. 通用工程习惯 —— 兜底。

**冲突时以 rules 为准。** 每次开始绘制/修改工程前，先读 rules 与 flow；用户新提的约束应先落进 `knowledge/rules.md` 再执行。

> `knowledge/` 目录**自动扫描**：任何 `.md` 都是一个主题（id = 文件名小写），用户可自行新增；
> 编辑内容即刻生效，无需改代码或重启。

## 工具速查

| 工具 | 用途 | 时机 |
|---|---|---|
| `easyeda_health` | 守护进程 + 已连窗口（windowId/connectorVersion/目标工程文档） | 任何现场操作前；`windows: []` 就别动手 |
| `easyeda_knowledge` | **rules（用户规则）** / **flow（全流程 Runbook）** / process / drawing / docs | 开工前、每阶段前 |
| **`easyeda_apply`** | **回放 playbook**：可 `dryRun`、可 `resume`、步内带 capture/assert 门 | **批量写入的首选通道** |
| **`easyeda_gate`** | 阶段验收门与只读检查（sch/pcb） | 每推进一阶段；结果只说明其覆盖的事实 |
| `easyeda_actions` | 发现类型化动作（name/domain/mutates/inputs） | 执行单个动作前查动作名与入参 |
| `easyeda_call` | 执行一个类型化动作 | 单点读写，或 apply 覆盖不到的动作 |
| `easyeda_blocks` | 复用成熟电路块（CH340/ESP32 下载/按键/降压/USB Hub…） | 有可复用拓扑时 |
| `easyeda_project_transfer` | 工程 open / export(.epro2) | 打开工程或导出归档 |
| `easyeda_docs` | 实时拉取官方文档正文（截断） | 核对最新规则/API 时 |
| `easyeda_workflow` | 【已弃用】旧受控流程记录 | 仅兼容历史工程；进度改用 `easyeda_gate(scope:"sch", command:"status")` |

## 执行通道优先级

1. **`easyeda_apply`（playbook）** —— 批量、可 dry-run、可 resume、步内带门。
   上游 esp32-mini 样例用它跑完原理图 47 步 + PCB 182 步并逐条对齐金板铜几何。
2. **`easyeda_gate`** —— 阶段门与只读检查。
3. `easyeda_call` —— 单个类型化动作。
4. 裸 `easyeda <子命令>`（shell）—— 只有上面都没有的才用，且**先 `--help` 核对**。

`easyeda_apply` 的确认门（如清页）**默认不会被自动批准**；确认过 playbook 内容后才显式传 `yes`。

## 全流程阶段阶梯（详细版见 `easyeda_knowledge(topic:"flow")`）

**原理图 S0–S6**：S0 设计提案（`spec validate --strict`）→ S1 页面纸张 → S2 器件放置
→ S3 连线/网络标（`autoconnect` / `connect` / `netflag` / `no-connect`）→ S4 位号与身份
→ **S5 检查门 `sch gate --strict`**（layout-lint → check → bridge-check → drc）
→ S6 `sch save` → `doc reload` → fresh 回读。

**PCB P0–P10**：P0 Board 绑定 → P1 `pcb import-changes` → P2 布局（`place-constrained`
先 `--dry-run`）→ P3 板框 → P4 禁布/区域 → P5 设计规则 → P6 关键网（`route-critical`）
→ P7 布线（`route-short` / `track` / `via` / `autoroute`）→ P8 铺铜（`pour-fit` → `pour-rebuild`）
→ P9 丝印 → **P10 终检**（`pcb drc --strict` + `pcb check --strict`）→ 交付
（`bom export` / `stage-snapshot` / `project export`）。

## 硬性护栏

- **用户规则优先**：`rules` 里的约定（含"硬性禁止"）高于内置原则与通用习惯；不确定就先问，别擅自放宽。
- **先读后写**：写前读真实器件/引脚/网络/板框/叠层/DRC；写后回读对账。截图只是辅助证据，不是布局/连通权威。
- **写操作必须绑定 project + doc**（除 `project.create` 只绑 window）；多窗口用 windowId 消歧。
- **同窗口的类型化调用串行**；只读核查可并行。
- **部分成功/超时/无法确认 → 停止盲目重试**，保留错误、输入与已知状态，标 `planned/unsupported`。
- **缺接口即停**：不用 `debug.exec_js` 绕过缺失接口；缺失就修工具/连接器，不手工兜底。
- **保存是安全网，不是完成证据**：关键节点显式保存 + 真实重载 + 新回读。
- **布局两轮自检 + 用户确认**后才进整板布线。
- **规则/参数以官方为准**：数值结论回到 `easyeda_docs` 或官网核对，不以记忆断言（受控阻抗尤甚）。
- **门只说明其覆盖的事实**：DRC 通过 ≠ 连通率通过，连通率 ≠ 核心/外围归属正确；
  缺测、读回失败、未保存或未重开核验一律标 `incomplete`。
