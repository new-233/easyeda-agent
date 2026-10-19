# 全流程绘制 Runbook（需求 → 成品板）

> 本文件是「一块板从需求到交付」的**执行脊柱**：每个阶段要跑什么、跑到哪个门、
> 回读什么才算数。工具：`easyeda_apply`（批量回放）/ `easyeda_gate`（阶段门与只读检查）/
> `easyeda_call`（单个类型化动作）。命令名与旗标均按本机 `easyeda --help` 现场核对。
>
> **规则优先级**：`easyeda_knowledge(topic:"rules")`（用户自定义）> 本文件 > `process`/`drawing` > 通用习惯。

## 0. 每轮开工先确认（不通过就不要动工程）

1. `easyeda_health` —— 必须 `status: found`，且 **`windows` 非空**、目标工程/文档匹配。
   - `windows: []` = 连接器没有挂上任何 EDA 窗口，**现场读写一律做不了**。此时停下来请用户
     打开 EasyEDA Pro 并开启「允许外部交互」，**不要**启动桌面版、不要刷新页面、不要手工兜底。
   - `hostCompatibility` 为 V3/block → 停止写入并请用户升级；V4 低于推荐 4.1.60 提示升级。
2. `versionGate.verdict` 为 `ok`（CLI 与 daemon 同版）。daemon 落后时 `easyeda update` 后重启 daemon。
3. **daemon 的文件权限**：`zones set` / `group create` / `workflow` 类命令要写 `~/.easyeda-agent/`。
   若 daemon 跑在受限文件沙箱里（工作区之外不可写），这些命令报
   `mkdir: Access is denied`，功能分区框与虚拟组**全链路阻塞**。
   实测：放行盘符访问后同一命令可正常建目录 → 遇到该报错**先查沙箱**，别误判成 EasyEDA 平台缺陷。
4. autosave 默认开（`--autosave-debounce 3s`），但它是**安全网不是完成证据**：
   关键节点仍要显式 save → 有界 `doc reload` → fresh 回读。

## 1. 执行通道的选择（顺序即优先级）

| 优先级 | 通道 | 何时用 |
|---|---|---|
| 1 | **`easyeda_apply`**（playbook） | 批量写入。可 `dryRun` 看计划、可 `resume` 续跑、步内带 capture/assert 门。上游 esp32-mini 样例用它跑完原理图 47 步 + PCB 182 步并逐条对齐金板铜几何。**全流程批量首选。** |
| 2 | **`easyeda_gate`** | 阶段门与只读检查（见第 3 节）。 |
| 3 | `easyeda_call` | 单个类型化动作。 |
| 4 | 裸 `easyeda <子命令>`（shell） | 只有上面都没有的才用；**先 `--help` 核对**再拼。 |

- `easyeda_apply` 的确认门（如清页）默认**不会被自动批准**；确认过 playbook 内容后才显式传 `yes`。
- 禁止：GUI / CUA / 鼠标键盘 / 属性面板 / 工程树；禁止用 `debug.exec_js` 绕过缺失接口。
- 缺能力就标 `planned` / `unsupported` 并补工具，**不手工兜底**。

## 2. 阶段阶梯

### 原理图 S0–S6

| 阶段 | 目标 | 主命令 | 门 / 回读 |
|---|---|---|---|
| S0 | 需求 → 设计提案 | `easyeda spec validate --strict`、`spec show` | 枚举值/矛盾/缺口全过 |
| S1 | 页面与纸张 | `sch page-new`、`sch pages`、`sch titleblock` | `sch sheet-geometry` |
| S2 | 器件放置 | `sch place`、`sch block-apply`、`sch materialize` | `sch list`、`sch layout-lint` |
| S3 | 连线 / 网络标 | `sch autoconnect --spec`、`sch connect`、`sch netflag`、`sch no-connect` | `sch read`、`sch netlist` |
| S4 | 位号与身份 | `sch designators`、`sch resolve-lcsc`、`sch modify` | `sch list` 位号与型号逐条对 |
| S5 | **检查门** | `sch gate --strict`（内含 layout-lint → check → bridge-check → drc） | `sch status` 逐条从活体推导；门必须过 |
| S6 | 保存与持久化 | `sch save` → `doc reload` → fresh 回读 | 保存后重开逐脚一致 |

- `sch wire` 是**逃生接口**（CLI 自述 "ESCAPE HATCH"）：常规走 `autoconnect` / `block-apply`。
  必须用时写明理由，且平行线之间**不能共线**（EasyEDA 会合并共线网络 → 隐性短路）。
- `netflag` 必须通过**真实非零导线**连到引脚；明确的 NC 才用 `no-connect`，
  未知或缺失连接**不能**自动改成 NC。

### PCB P0–P10

| 阶段 | 目标 | 主命令 | 门 / 回读 |
|---|---|---|---|
| P0 | Board 绑定 | `board create` / `current` / `rebind` | `board list` |
| P1 | 原理图导入 | `pcb import-changes` | fresh `pcb list`；位号与原理图一致 |
| P2 | 布局 | `pcb place-constrained --dry-run`、`pcb layout-plan`、`pcb refine` | `pcb layout-lint`、`pcb layout-score` |
| P3 | 板框 | `pcb outline-set`、`outline-round --dry-run`、`outline-fit` | `pcb outline-get` |
| P4 | 禁布 / 区域 | `pcb region`、`pcb antenna-keepout` | 见陷阱 3（能力受限） |
| P5 | 设计规则 | `pcb drc-rules`、`pcb drc-rules-set --pour-clearance` | `pcb drc-rules` 回读 |
| P6 | 关键网 | `pcb route-critical` | `pcb net-path`、`pcb report` |
| P7 | 布线 | `pcb route-short`、`pcb track`、`pcb via`、`pcb autoroute`、`pcb import-autoroute` | `pcb net-path` 逐条证明 |
| P8 | 铺铜 | `pcb pour-fit` → `pour-rebuild` →（新板）`doc reload` → `pour-rebuild` | `pcb poured-list` |
| P9 | 丝印 | `pcb silk-align`、`silk-add`、`silk-netnames`、`silk-labels` | 实测碰撞为 0，极性正确 |
| P10 | **终检与交付** | `pcb drc --strict`、`pcb check --strict`、`pcb report` | `pcb stage-snapshot --fit-mode board` 两轮自检 |

交付另跑：`bom export`、`pcb snapshot`、`sch export-image`、`project export`（`.epro2`，不覆盖）。

## 3. 验收门怎么读

`easyeda_gate(scope, command, ...)` 的登记范围：

- **sch**：`gate` / `status` / `check` / `drc` / `layout-lint` / `bridge-check` / `read` / `netlist` / `clusters` / `layout-score` / `save`
- **pcb**：`drc` / `check` / `layout-lint` / `layout-score` / `report` / `drc-rules` / `board-info` / `layers` / `nets` / `list` / `pour-list` / `save`

要点：

- **`sch gate --strict`** 是最强的原理图门：按固定顺序跑
  `layout-lint → check → bridge-check → drc`，可用 `only` / `skip` 限定阶段；`--strict`
  把 advisory（过近间距、warn 级、孤儿桩）提升为阻断。`allPages` 与 `strict` **不能同时用**
  （非激活页只有浅数据）。
- 门只说明它覆盖到的事实：DRC 通过不等于连通率通过，连通率不等于核心/外围归属正确。
  缺测、读回失败、未保存或未重开核验 → 标 `incomplete`。
- `save` 是写操作，必须显式绑 `project` + `doc`（工具会拒绝对不绑的调用）。
- 未登记的旗标组合会被**拒绝**而不是拼出一条错误命令（fail-closed）。
  要用的旗标不在白名单里，先 `easyeda <scope> <command> --help` 核对，再按需扩展白名单。

## 4. 实测陷阱（已踩过，不要重踩）

1. **新 PCB 的铺铜 reflow 用「创建时的规则快照」**：之后写规则、重灌铺铜、tab 切走切回
   都不生效，只有**真正关闭+重开文档**（`easyeda doc reload`）后才按当前规则算。
   workaround（上游已固化）：`pcb drc-rules-set --pour-clearance 12`（raise-only）
   → `doc reload` → `pour-rebuild` 二次。
   来源：上游 `examples/esp32-mini/README.md`（2026-07-04 探针定位）。
2. **`pcb layout-lint --gate / --min-score / --max-crossings` 是弃用兼容模式**：
   只显示历史阈值，**不授权也不阻断**布线。别拿它当门（所以白名单里故意没有它）。
3. **`pcb.region.create` 的命名 region 在 EasyEDA Pro 4.1.71 被平台拒绝**
   （`Region name is only supported with follow-rule (9)`）→ `pcb antenna-keepout`
   返回 `planned:1 / created:0`。这是**能力阻塞**：该考点保持未满足、标 `unsupported`，
   **不要**用 GUI 或改属性兜底。来源：本机 `esp32s3-minimal/REPORT.md`（4.1.71 实测）。
4. **`easyeda_workflow` 与 `easyeda pcb stage` 已 Deprecated**：进度用 `sch status`
   和门命令从活体推导，不要新建受控记录。
5. **长网名会撑爆标记**：12 字符网名（如 `USB_DM_CONN`）在 10 间距引脚上把标记推到图纸外
   （实测 x=-174）→ 压到 4 字符左右并重排。来源：同上 REPORT.md。
6. **批量写入会触发宿主 `RealTimeSync` 超时降级**（清页 + 27 place + 86 autoconnect 规模）。
   对策：分批 + 暂停；确实需要时按用户要求走 typed `easyeda web reload`，不要把它当自动兜底。
7. **`pcb outline-fit` 必须在连接器贴边之后跑**，否则板框按导入散点撑大（实测 127×55 mm）。
8. **`pcb auto-place` 会跳过 `J*` / `CN*` / `USB*` 边缘连接器** → 连接器要靠
   `pcb place-constrained` 贴边（先 `--dry-run` 看计划）。
9. **`overwriteCurrentRuleConfiguration` 必须传裸 config**：把
   `getCurrentRuleConfiguration()` 的 `{name, config}` 整体传进去会**静默失败**
   （resolve undefined 且读回不变）。
10. **System 库不可写**：加 region/keepout 前先确认可写库；已有器件的
    device / footprint / 3D model 绑定正确时，加区域**不得**重绑或复制整套模型。

## 5. 交付判据（什么算「做完了」）

- **原理图**：floating pins = 0、bridge = 0、`sch gate --strict` 通过、
  `sch save` 返回 `saved:true`，且 save → reload → fresh 回读逐脚一致。
- **PCB**：`pcb drc` 无错误、`pcb check --strict` 通过、全部必接网络连通、
  丝印极性正确、save → reload → fresh 回读一致。
- **布局**：连续两轮整板自检（第 2 轮严格 save → reload → fresh dump → fresh render），
  两轮均无待修问题后展示复核包并**等用户确认**；确认前不进整板布线。
- **证据**：截图/预览只是辅助证据，**不能**替代 typed readback，也不能替代 DRC/连通率。
  报告写事实级检查结果与未覆盖项，不用阶段签字或综合评分代替判断。
