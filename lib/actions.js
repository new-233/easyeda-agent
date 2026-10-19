/**
 * actions.js — 类型化动作层。
 *
 * 所有对工程的真实读写都收敛到「类型化动作」(typed action)。动作目录由
 * `easyeda actions` 动态发现：每条动作带 name / domain / mutates / inputs / description。
 * 本层负责：
 *   1. 加载并缓存动作目录；
 *   2. 按 domain / search / mutates 过滤；
 *   3. 把 (action, project, doc, window, payload) 组装成 CLI 参数；
 *   4. 项目级 transfer / workflow / circuit-blocks 的专用参数组装。
 *
 * 路由守卫与参考实现保持一致：写操作必须显式绑定 project + doc，
 * project.create 只绑定 window，project.open/export 走项目级 UUID 守卫。
 */
import { runEasyeda } from './transport.js'

/** 暴露给 agent 的动作域（与参考实现的 MCP 工具面一致）。 */
export const DOMAIN_NAMES = [
  'artifact',
  'board',
  'document',
  'pcb',
  'project',
  'schematic',
  'system',
]

let catalogCache = null

/** 加载动作目录（进程内缓存一次）。 */
export async function loadCatalog(config, { force = false } = {}) {
  if (catalogCache && !force) return catalogCache
  const exec = await runEasyeda(['actions'], { config, timeoutMs: 30_000 })
  if (!exec.ok || !Array.isArray(exec.result)) {
    throw new Error('cannot load action catalog: ' + JSON.stringify(exec))
  }
  catalogCache = exec.result
  return catalogCache
}

/** 按 domain / search / mutates 过滤动作目录。 */
export function filterActions(actions, { domain, search, mutates } = {}) {
  const needle = String(search || '').trim().toLowerCase()
  return actions.filter((action) => {
    if (domain && action.domain !== domain) return false
    if (typeof mutates === 'boolean' && action.mutates !== mutates) return false
    if (!needle) return true
    return [action.name, action.description, ...(action.inputs || [])]
      .join(' ')
      .toLowerCase()
      .includes(needle)
  })
}

/** 组装普通类型化动作调用：easyeda --project P --doc D call <action> [--payload {...}] [--window W] */
export function buildCallArgs(action, input = {}) {
  const args = []
  if (input.project) args.push('--project', input.project)
  if (input.doc) args.push('--doc', input.doc)
  args.push('call', action)
  if (input.payload && Object.keys(input.payload).length > 0) {
    args.push('--payload', JSON.stringify(input.payload))
  }
  if (input.window) args.push('--window', input.window)
  return args
}

/** 带路由守卫的动作调用参数组装（需要目录里的 mutates 元数据）。 */
export function buildActionCallArgs(action, input = {}) {
  if (action.name === 'project.create') {
    if (typeof input.window !== 'string' || !input.window.trim()) {
      throw new Error('project.create requires an explicit window from easyeda_health')
    }
    if (input.project || input.doc) {
      throw new Error('project.create does not accept project or doc routing; use payload.friendlyName')
    }
  } else if (action.name === 'project.open' || action.name === 'project.export') {
    if (typeof input.window !== 'string' || !input.window.trim() || input.project || input.doc) {
      throw new Error('Project transfer requires an explicit window and payload.projectUuid; omit project/doc routing')
    }
    if (typeof input.payload?.projectUuid !== 'string' || !input.payload.projectUuid.trim()) {
      throw new Error('payload.projectUuid is required')
    }
    if (action.name === 'project.open' && input.payload.allowDiscardUnsaved !== true) {
      throw new Error('Save documents first; payload.allowDiscardUnsaved must be true')
    }
  } else if (action.mutates && (!input.project || !input.doc)) {
    throw new Error(`mutating action ${action.name} requires both project and doc`)
  }
  return buildCallArgs(action.name, input)
}

/** 组装 workflow 状态机参数。 */
export function buildWorkflowArgs(input) {
  if (!input.project) throw new Error('project is required for workflow operations')
  const args = ['--project', input.project]
  if (input.doc) args.push('--doc', input.doc)
  args.push('workflow', input.operation)
  switch (input.operation) {
    case 'init':
      break
    case 'status':
      args.push('--json')
      if (input.reconcile) args.push('--reconcile')
      break
    case 'advance':
      if (Number.isInteger(input.minScore)) args.push('--min-score', String(input.minScore))
      if (Number.isInteger(input.maxCrossings)) args.push('--max-crossings', String(input.maxCrossings))
      break
    case 'confirm':
      if (!['layout', 'outline'].includes(input.confirmation)) {
        throw new Error('confirmation must be layout or outline')
      }
      args.push(input.confirmation)
      if (input.note) args.push('--note', input.note)
      break
    case 'reset':
      if (input.resetAll === true) args.push('--all')
      else if (input.resetFrom) args.push('--from', input.resetFrom)
      else throw new Error('reset requires resetAll=true or resetFrom')
      break
    default:
      throw new Error(`unsupported workflow operation: ${input.operation}`)
  }
  return args
}

/** 组装电路块参数。 */
export function buildBlocksArgs(input) {
  switch (input.operation) {
    case 'list':
      return ['blocks', 'ls']
    case 'search':
      if (!input.query) throw new Error('query is required for blocks search')
      return ['blocks', 'search', input.query]
    case 'show':
      if (!input.id) throw new Error('id is required for blocks show')
      return ['blocks', 'show', input.id]
    default:
      throw new Error(`unsupported blocks operation: ${input.operation}`)
  }
}

/** 组装项目级 transfer 参数（open / export）。 */
export function buildProjectTransferArgs(input = {}) {
  for (const key of ['window', 'projectUuid']) {
    if (typeof input[key] !== 'string' || !input[key].trim()) throw new Error(`${key} is required`)
  }
  if (input.project || input.doc) throw new Error('Use projectUuid/window, not project/doc routing')
  const args = ['project', input.operation, '--window', input.window, '--project-uuid', input.projectUuid]
  if (input.operation === 'open') {
    if (input.allowDiscardUnsaved !== true) throw new Error('Save all documents first and explicitly acknowledge allowDiscardUnsaved')
    if (input.out) throw new Error('out applies only to export')
    args.push('--allow-discard-unsaved')
    if (input.pageUuid) args.push('--page-uuid', input.pageUuid)
  } else if (input.operation === 'export') {
    if (typeof input.out !== 'string' || !input.out.toLowerCase().endsWith('.epro2')) {
      throw new Error('out must be a new .epro2 file')
    }
    if (input.pageUuid) throw new Error('pageUuid applies only to open')
    if (input.allowDiscardUnsaved) throw new Error('allowDiscardUnsaved applies only to open')
    args.push('--out', input.out)
  } else {
    throw new Error('operation must be open or export')
  }
  return args
}

// ---------------------------------------------------------------------------
// Playbook 回放（`easyeda apply`）
//
// 这是全流程自主绘制的主力执行通道：一份 playbook 把「放置 → 接线 → 门禁 →
// 铺铜 → 回读」编成可 dry-run、可 resume、带 capture/assert 门的步骤序列，
// 好过 agent 逐条发几百次单步调用（每次一个进程，慢且无法原子续跑）。
//
// 安全边界：只接受下面这张白名单里的开关，绝不把调用方的键名直接拼进 argv，
// 因此不存在任意 CLI 旗标注入；`yes`（自动批准确认门）必须由调用方显式给出，
// 工具不会替它打开——清页一类的确认门保持有效。
// ---------------------------------------------------------------------------

/** apply 布尔开关白名单：入参键 → CLI 旗标。 */
const APPLY_BOOL_FLAGS = {
  dryRun: '--dry-run',
  resume: '--resume',
  quiet: '--quiet',
  yes: '--yes',
}

/** apply 取值的字符串旗标白名单。 */
const APPLY_VALUE_FLAGS = {
  from: '--from',
  to: '--to',
  journal: '--journal',
}

/** 组装 playbook 回放参数。 */
export function buildApplyArgs(input = {}) {
  const playbook = typeof input.playbook === 'string' ? input.playbook.trim() : ''
  if (!playbook) throw new Error('playbook is required (path to a .json playbook)')
  if (!/\.json$/i.test(playbook)) throw new Error('playbook must be a .json file')
  if (input.project && input.window) throw new Error('route by project or window, not both')
  if (input.dryRun === true && input.resume === true) {
    throw new Error('dryRun and resume are contradictory: dryRun executes nothing, so there is nothing to resume')
  }

  const args = []
  if (input.project) args.push('--project', input.project)
  args.push('apply', playbook)
  if (input.doc) args.push('--doc', input.doc)
  if (input.window) args.push('--window', input.window)

  for (const [key, flag] of Object.entries(APPLY_BOOL_FLAGS)) {
    if (input[key] === true) args.push(flag)
    else if (input[key] !== undefined && typeof input[key] !== 'boolean') {
      throw new Error(`${key} must be a boolean`)
    }
  }
  for (const [key, flag] of Object.entries(APPLY_VALUE_FLAGS)) {
    if (input[key] === undefined) continue
    const value = String(input[key]).trim()
    if (!value) throw new Error(`${key} must not be empty`)
    args.push(flag, value)
  }
  if (input.stepDelay !== undefined) {
    const delay = Number(input.stepDelay)
    if (!Number.isFinite(delay) || delay < 0) throw new Error('stepDelay must be a non-negative number of seconds')
    args.push('--step-delay', String(delay))
  }
  if (input.vars !== undefined) {
    const vars = input.vars
    if (vars === null || typeof vars !== 'object' || Array.isArray(vars)) {
      throw new Error('vars must be an object of KEY=VALUE overrides')
    }
    for (const [key, value] of Object.entries(vars)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`invalid playbook var name: ${key}`)
      if (value === null || typeof value === 'object') throw new Error(`playbook var ${key} must be a scalar`)
      args.push('--var', `${key}=${value}`)
    }
  }
  return args
}

// ---------------------------------------------------------------------------
// 验收门（`easyeda sch ...` / `easyeda pcb ...` 的只读与门禁子命令）
//
// 全流程每推进一阶段都要跑门：布局门、check 门、bridge 门、官方 DRC 门。
// 这些命令此前只能靠 agent 自己拼 shell，既容易拼错又无法约束；
// 这里按 scope+command 给出精确白名单，旗标一律由键名推导，未登记的键直接报错
// （fail-closed），不给「猜一个旗标名」的空间。
//
// 白名单只收录已用 `--help` 现场核对过的旗标；未核对过的子命令一律不接受任何额外旗标。
// ---------------------------------------------------------------------------

/** 键名 → 旗标：camelCase 转 kebab-case，全部已核对。 */
function flagName(key) {
  return '--' + key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
}

/** 取值类型：bool（无值开关）/ value（字符串）/ number（数值）。 */
export const GATE_SPEC = {
  sch: {
    gate: { flags: { strict: 'bool', json: 'bool', allPages: 'bool', failFast: 'bool', only: 'value', skip: 'value', minGap: 'number', pinEps: 'number', overlapEps: 'number' } },
    status: { flags: { json: 'bool', allPages: 'bool' } },
    check: { flags: { strict: 'bool', json: 'bool', allPages: 'bool', stay: 'bool', page: 'value', overlapEps: 'number' } },
    drc: { flags: { strict: 'bool', json: 'bool', verbose: 'bool' } },
    'layout-lint': { flags: { strict: 'bool', json: 'bool', allPages: 'bool', includeNonParts: 'bool', minGap: 'number', pinEps: 'number' } },
    'bridge-check': { flags: {} },
    read: { flags: {} },
    netlist: { flags: {} },
    clusters: { flags: {} },
    'layout-score': { flags: {} },
    save: { flags: {} },
  },
  pcb: {
    drc: { flags: { strict: 'bool', json: 'bool', timeout: 'number' } },
    check: { flags: { strict: 'bool', json: 'bool', spec: 'value', couplingW: 'number' } },
    'layout-lint': { flags: { json: 'bool', minGap: 'number' } },
    'layout-score': { flags: {} },
    report: { flags: {} },
    'drc-rules': { flags: {} },
    'board-info': { flags: {} },
    layers: { flags: {} },
    nets: { flags: {} },
    list: { flags: {} },
    'pour-list': { flags: {} },
    save: { flags: {} },
  },
}

/** 工具层用的命令枚举（scope → [command]）。 */
export const GATE_COMMANDS = Object.fromEntries(
  Object.entries(GATE_SPEC).map(([scope, commands]) => [scope, Object.keys(commands)]),
)

/** 组装验收门参数。未登记的旗标键一律拒绝，避免拼出错误的 CLI 调用。 */
export function buildGateArgs(input = {}) {
  const scope = String(input.scope || '').trim()
  const command = String(input.command || '').trim()
  if (!GATE_SPEC[scope]) throw new Error(`scope must be one of: ${Object.keys(GATE_SPEC).join(', ')}`)
  const spec = GATE_SPEC[scope][command]
  if (!spec) throw new Error(`unknown ${scope} command: ${command}; allowed: ${GATE_COMMANDS[scope].join(', ')}`)
  if (input.project && input.window) throw new Error('route by project or window, not both')
  // save 是写操作：与其它写动作一致，必须显式绑定 project + doc，避免存错页面。
  if (command === 'save' && (!input.project || !input.doc)) {
    throw new Error(`${scope} save is a write: bind both project and doc explicitly`)
  }

  const args = []
  if (input.project) args.push('--project', input.project)
  args.push(scope, command)
  if (input.doc) args.push('--doc', input.doc)
  if (input.window) args.push('--window', input.window)

  const routingKeys = new Set(['scope', 'command', 'project', 'doc', 'window', 'timeoutMs'])
  // 先拒绝未登记的键（fail-closed），再按白名单声明顺序输出旗标，
  // 这样 argv 与调用方的键顺序无关，可复现、可断言。
  for (const key of Object.keys(input)) {
    if (routingKeys.has(key) || input[key] === undefined) continue
    if (!spec.flags[key]) {
      const allowed = Object.keys(spec.flags)
      throw new Error(
        `${scope} ${command} has no flag "${key}"` +
        (allowed.length ? `; allowed: ${allowed.join(', ')}` : '; it takes no extra flags'),
      )
    }
  }
  for (const [key, kind] of Object.entries(spec.flags)) {
    const value = input[key]
    if (value === undefined) continue
    const flag = flagName(key)
    if (kind === 'bool') {
      if (typeof value !== 'boolean') throw new Error(`${key} must be a boolean`)
      if (value) args.push(flag)
    } else if (kind === 'number') {
      const num = Number(value)
      if (!Number.isFinite(num)) throw new Error(`${key} must be a number`)
      args.push(flag, String(num))
    } else {
      const text = String(value).trim()
      if (!text) throw new Error(`${key} must not be empty`)
      args.push(flag, text)
    }
  }
  return args
}
