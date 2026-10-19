/**
 * tools.js — 工具层：把类型化动作 + 知识层暴露成 DSH 工具。
 *
 * 工具面与参考实现 easyeda-agent 的 MCP 工具面对齐，并新增知识查询：
 *   easyeda_health            守护进程 / 窗口健康
 *   easyeda_actions           发现类型化动作
 *   easyeda_call              执行一个类型化动作（核心「手」）
 *   easyeda_apply             回放 playbook（批量/可 dry-run/可 resume —— 全流程主力通道）
 *   easyeda_gate              跑阶段验收门与只读检查（sch/pcb）
 *   easyeda_blocks            电路块复用（list/search/show）
 *   easyeda_workflow          受控设计流程状态机（已弃用，见 tools 内说明）
 *   easyeda_project_transfer  工程 open / export
 *   easyeda_knowledge         查询工艺参数 / 绘制原则（本框架增量）
 *   easyeda_docs              实时拉取官方文档（本框架增量）
 *
 * 返回统一信封 { ok, result?, error? }，agent 读取结构化数据后自行决策。
 */
import { DOMAIN_NAMES, GATE_COMMANDS, buildActionCallArgs, buildApplyArgs, buildBlocksArgs, buildGateArgs, buildProjectTransferArgs, buildWorkflowArgs, filterActions, loadCatalog } from './actions.js'
import { fetchDoc, getTopic, listTopics } from './knowledge.js'
import { runEasyeda } from './transport.js'

/** 统一的文本结果渲染：把返回的 JsonValue 打印成文本块。 */
function textOutput() {
  return {
    schema: { type: 'object', additionalProperties: true },
    render(_args, value) {
      const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
      return [{ type: 'text', text }]
    },
  }
}

/** 统一信封：CLI 执行结果透传，保证 agent 看到一致结构。 */
function envelope(exec) {
  return exec
}

const ROUTE_PROPS = {
  project: { type: 'string', description: '现有 EasyEDA 工程名或 UUID。写操作（除 project.create）必填。' },
  doc: { type: 'string', description: '现有原理图页或 PCB 的名称/UUID。写操作（除 project.create）必填。' },
  window: { type: 'string', description: 'easyeda_health 返回的 connector windowId。project.create 必填；多窗口时用于消歧。' },
  payload: { type: 'object', description: '类型化动作的入参；用 easyeda_actions 查看具体字段。', additionalProperties: true },
}

/** 构造全部工具定义。 */
export function buildToolDefinitions(ctx, config) {
  const defs = []

  defs.push({
    name: 'easyeda_health',
    description: '检查本地 easyeda 守护进程与已连接的 EasyEDA Pro 窗口（windowId / connectorVersion / 目标工程与文档）。任何现场操作前先调用。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: textOutput(),
    isConcurrencySafe: () => true,
    async execute() {
      return envelope(await runEasyeda(['daemon', 'health'], { config, timeoutMs: 30_000 }))
    },
  })

  defs.push({
    name: 'easyeda_actions',
    description: `发现并检索全部类型化 EasyEDA 动作（共 ${DOMAIN_NAMES.join('/')} 域）。返回动作的 name / domain / mutates / inputs，是 easyeda_call 的入参依据。`,
    parameters: {
      type: 'object',
      properties: {
        domain: { type: 'string', enum: DOMAIN_NAMES, description: '限定动作域。' },
        search: { type: 'string', description: '按名称/描述/入参做子串检索。' },
        mutates: { type: 'boolean', description: 'true 只看写动作，false 只看只读动作。' },
      },
      additionalProperties: false,
    },
    output: textOutput(),
    isConcurrencySafe: () => true,
    async execute(args) {
      let catalog
      try {
        catalog = await loadCatalog(config, { force: true })
      } catch (error) {
        // 后端不可用属于环境问题：与其他 CLI 工具一致，返回结构化失败而非抛异常。
        return { ok: false, error: { message: String(error?.message ?? error) } }
      }
      const filtered = filterActions(catalog, args)
      return { ok: true, result: { total: catalog.length, count: filtered.length, actions: filtered } }
    },
  })

  defs.push({
    name: 'easyeda_call',
    description: '执行一个类型化 EasyEDA 动作（原理图/PCB 读写的核心入口）。先用 easyeda_actions 查动作名与入参，再据此组装 payload；写操作必须显式绑定 project + doc。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: '精确的类型化动作名，如 schematic.* / pcb.*（见 easyeda_actions）。' },
        ...ROUTE_PROPS,
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: textOutput(),
    async execute(args) {
      let catalog
      try {
        catalog = await loadCatalog(config)
      } catch (error) {
        return { ok: false, error: { message: String(error?.message ?? error) } }
      }
      // 找不到动作名是调用方失误：抛出，让 agent 明确去查 easyeda_actions。
      const action = catalog.find((a) => a.name === args.action)
      if (!action) throw new Error(`unknown action: ${args.action}; use easyeda_actions to list available actions`)
      const cliArgs = buildActionCallArgs(action, args)
      return envelope(await runEasyeda(cliArgs, { config }))
    },
  })

  defs.push({
    name: 'easyeda_apply',
    description:
      '回放一份 playbook（`easyeda apply`）：把「放置→接线→门禁→铺铜→回读」编成可 dry-run、可 resume、带 capture/assert 门的步骤序列。' +
      '全流程批量的首选执行通道——比逐条 easyeda_call 快得多，且中断后可续跑，比现场试摆可靠。先 dryRun 看计划再落盘。' +
      'yes 会自动批准确认门（如清页），只在已确认 playbook 内容时使用；默认不会替你打开确认门。',
    parameters: {
      type: 'object',
      properties: {
        playbook: { type: 'string', description: 'playbook .json 路径（必需）。' },
        project: { type: 'string', description: '工程名或 UUID（→ --project）。与 window 二选一。' },
        doc: { type: 'string', description: '目标文档（→ --doc）；覆盖 playbook 的 meta.doc。' },
        window: { type: 'string', description: '连接器 windowId（→ --window）。与 project 二选一。' },
        dryRun: { type: 'boolean', description: '只校验并打印计划，不执行任何写入。' },
        resume: { type: 'boolean', description: '跳过 journal 中已成功的步骤并恢复捕获变量。与 dryRun 互斥。' },
        from: { type: 'string', description: '从该步开始（步 id 或 1 起的序号）。' },
        to: { type: 'string', description: '执行到该步为止（步 id 或 1 起的序号）。' },
        journal: { type: 'string', description: 'journal 路径（默认 <playbook>.journal.jsonl）。' },
        stepDelay: { type: 'number', minimum: 0, description: '每步之间的暂停秒数（演示/录像节奏）。' },
        vars: { type: 'object', description: '覆盖或新增 playbook 变量：KEY=VALUE。', additionalProperties: true },
        quiet: { type: 'boolean', description: '只打印失败与最终汇总。' },
        yes: { type: 'boolean', description: '自动批准确认门控步骤（如清页）。默认关闭以保持确认门有效。' },
        timeoutMs: { type: 'integer', minimum: 1000, maximum: 7200000, description: '单次回放超时毫秒，默认 3600000（1 小时；PCB 回放可达 20 分钟）。' },
      },
      required: ['playbook'],
      additionalProperties: false,
    },
    output: textOutput(),
    async execute(args) {
      const cliArgs = buildApplyArgs(args)
      return envelope(await runEasyeda(cliArgs, { config, timeoutMs: args.timeoutMs ?? 3_600_000 }))
    },
  })

  defs.push({
    name: 'easyeda_gate',
    description:
      '跑原理图/PCB 的只读检查与阶段验收门。sch: ' + GATE_COMMANDS.sch.join('/') + '；pcb: ' + GATE_COMMANDS.pcb.join('/') + '。' +
      '每推进一阶段都要跑门（布局门 → check 门 → 桥接门 → 官方 DRC），结果只说明其覆盖的事实。' +
      '旗标按白名单校验：未登记的组合会被拒绝，而不是拼出一条错误的 CLI 命令。',
    parameters: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: Object.keys(GATE_COMMANDS), description: 'sch 或 pcb。' },
        command: { type: 'string', description: 'sch: ' + GATE_COMMANDS.sch.join('/') + '；pcb: ' + GATE_COMMANDS.pcb.join('/') + '。' },
        project: { type: 'string', description: '工程名或 UUID。' },
        doc: { type: 'string', description: '原理图页或 PCB 名/UUID；save 必填。' },
        window: { type: 'string', description: '连接器 windowId（多窗口消歧）。' },
        strict: { type: 'boolean', description: '把 warning/advisory 提升为阻断（gate/check/drc/layout-lint 支持者）。' },
        json: { type: 'boolean', description: '以 JSON 输出报告。' },
        allPages: { type: 'boolean', description: 'sch：逐页测（非激活页只有浅数据）。' },
        failFast: { type: 'boolean', description: 'sch gate：首个阻断失败即停。' },
        only: { type: 'string', description: 'sch gate：只跑这些阶段（layout-lint,check,bridge-check,drc）。' },
        skip: { type: 'string', description: 'sch gate：跳过这些阶段。' },
        minGap: { type: 'number', description: 'layout-lint 判定过近的最小间距（sch=mm，pcb=mil）。' },
        pinEps: { type: 'number', description: 'sch layout-lint：不同器件两脚算重合的最大距离（mm，0=严格相等）。' },
        overlapEps: { type: 'number', description: 'sch check/gate：标记重叠类规则的最小正面积（mm）。' },
        includeNonParts: { type: 'boolean', description: 'sch layout-lint：把非器件图元也纳入。' },
        page: { type: 'string', description: 'sch check：先切到该页再检查。' },
        stay: { type: 'boolean', description: 'sch check：用 page 时检查完留在该页。' },
        verbose: { type: 'boolean', description: 'sch drc：额外打印每条违规的原始 EDA 对象。' },
        maxCrossings: { type: 'integer', minimum: -1, description: 'pcb layout-lint：历史交叉阈值（-1=不限）。' },
        minScore: { type: 'integer', minimum: 0, maximum: 100, description: 'pcb layout-lint：历史评分阈值。' },
        spec: { type: 'string', description: 'pcb check：S0 spec JSON 路径（让 connector 规则读到声明的朝向）。' },
        couplingW: { type: 'number', description: 'pcb check：3W 规则系数。' },
        timeout: { type: 'integer', minimum: 1, description: 'pcb drc：等待 DRC 往返的秒数（默认 60）。' },
        timeoutMs: { type: 'integer', minimum: 1000, maximum: 7200000, description: 'CLI 调用超时毫秒，默认 600000（DRC 可能较慢）。' },
      },
      required: ['scope', 'command'],
      additionalProperties: false,
    },
    output: textOutput(),
    async execute(args) {
      const cliArgs = buildGateArgs(args)
      return envelope(await runEasyeda(cliArgs, { config, timeoutMs: args.timeoutMs ?? 600_000 }))
    },
  })

  defs.push({
    name: 'easyeda_blocks',
    description: '复用内置的成熟电路块（CH340、ESP32 自动下载、按键、降压、USB Hub 等）。list 列出全部，search 检索，show 看单个电路块详情。不需要运行中的守护进程。',
    parameters: {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: ['list', 'search', 'show'], description: 'list/search/show。' },
        query: { type: 'string', description: 'search 时必填的检索词。' },
        id: { type: 'string', description: 'show 时必填的电路块 id。' },
      },
      required: ['operation'],
      additionalProperties: false,
    },
    output: textOutput(),
    isConcurrencySafe: () => true,
    async execute(args) {
      return envelope(await runEasyeda(buildBlocksArgs(args), { config, timeoutMs: 30_000 }))
    },
  })

  defs.push({
    name: 'easyeda_workflow',
    description: '【已弃用】受控设计流程状态机：init / status / advance / confirm / reset。它包装的 `easyeda workflow` 在 CLI 里已标记 Deprecated，只保留历史工程兼容。新流程请用 easyeda_gate（sch status / sch gate / pcb drc 等）从活体推导进度，不要用本工具新建受控记录。',
    parameters: {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: ['init', 'status', 'advance', 'confirm', 'reset'] },
        project: { type: 'string', description: '工程名或 UUID。' },
        doc: { type: 'string', description: '文档名或 UUID。' },
        reconcile: { type: 'boolean', description: 'status 时：把持久化状态与在线文档对账。' },
        minScore: { type: 'integer', minimum: 0, maximum: 100, description: 'advance 时：最低布线评分。' },
        maxCrossings: { type: 'integer', minimum: -1, description: 'advance 时：最大飞线交叉数；-1 不限。' },
        confirmation: { type: 'string', enum: ['layout', 'outline'], description: 'confirm 时：确认 layout 或 outline。' },
        note: { type: 'string', description: 'confirm 时记录的人工复核说明。' },
        resetAll: { type: 'boolean', description: 'reset 时：清除全部确认。' },
        resetFrom: { type: 'string', description: 'reset 时：从该阶段起（含）清除。' },
      },
      required: ['operation', 'project'],
      additionalProperties: false,
    },
    output: textOutput(),
    async execute(args) {
      return envelope(await runEasyeda(buildWorkflowArgs(args), { config }))
    },
  })

  defs.push({
    name: 'easyeda_project_transfer',
    description: '打开或导出原生 EasyEDA 工程（.epro2）。open 会丢弃未保存数据，必须先保存所有文档并显式 acknowledge；export 写入一个不覆盖的新 epro2 归档并校验哈希。',
    parameters: {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: ['open', 'export'] },
        window: { type: 'string', minLength: 1, description: 'connector windowId。' },
        projectUuid: { type: 'string', minLength: 1, description: '目标工程 UUID。' },
        pageUuid: { type: 'string', minLength: 1, description: '仅 open：等待并打开该原理图页，然后核对双方身份。' },
        allowDiscardUnsaved: { type: 'boolean', description: '仅 open：保存全部文档后的显式确认。' },
        out: { type: 'string', description: '仅 export：新的本地 .epro2 路径（不覆盖已有文件）。' },
      },
      required: ['operation', 'window', 'projectUuid'],
      additionalProperties: false,
    },
    output: textOutput(),
    async execute(args) {
      return envelope(await runEasyeda(buildProjectTransferArgs(args), { config, timeoutMs: 90_000 }))
    },
  })

  defs.push({
    name: 'easyeda_knowledge',
    description: '查询项目规则（rules）、工艺参数（process）、绘制原则（drawing）与官方文档索引（docs）。不填 topic 返回主题目录；填 topic 返回该主题全文。knowledge/ 目录自动扫描——新增任意 .md 即成为新主题（id = 文件名小写），编辑内容立即生效。绘制前先查 rules（用户规则优先级最高）。',
    parameters: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: '主题 id：rules（用户自定义规则，最高优先级）、process（工艺参数）、drawing（绘制原则）、docs（官方文档索引），或 knowledge/ 下任意 .md 的文件名；省略则返回主题目录。' },
      },
      additionalProperties: false,
    },
    output: textOutput(),
    isConcurrencySafe: () => true,
    execute(args) {
      if (!args || !args.topic) {
        return { ok: true, result: { topics: listTopics() } }
      }
      const topic = getTopic(args.topic)
      return { ok: true, result: { id: topic.id, title: topic.title, chars: topic.chars, content: topic.content } }
    },
  })

  defs.push({
    name: 'easyeda_docs',
    description: '实时拉取官方文档（扩展 API / 设计规则 / JLCPCB 能力页等）并截断返回。用于绘制过程中核对最新工艺参数与规则，避免凭记忆。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '官方文档的 http(s) 绝对地址。' },
        maxChars: { type: 'integer', minimum: 100, maximum: 200000, description: '返回正文最大字符数，默认 20000。' },
        timeoutMs: { type: 'integer', minimum: 1000, maximum: 120000, description: '拉取超时毫秒，默认 20000。' },
      },
      required: ['url'],
      additionalProperties: false,
    },
    output: textOutput(),
    isConcurrencySafe: () => true,
    async execute(args) {
      const r = await fetchDoc(args.url, { maxChars: args.maxChars, timeoutMs: args.timeoutMs })
      return { ok: r.ok !== false, result: r }
    },
  })

  return defs
}
